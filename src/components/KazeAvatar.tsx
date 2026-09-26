/**
 * KazeAvatar — a cara 3D do Kaze, com sincronização labial.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ISTO É (e o que NÃO é)
 * ─────────────────────────────────────────────────────────────────────────────
 * Este componente NÃO gera voz. A voz continua a vir do Gemini Live, como
 * sempre. O avatar é apenas a cara do áudio que já está a tocar: lê a energia
 * da saída com o `getOutputLevel()` do `kazeLiveClient` e move os visemes.
 *
 * A razão de ser assim — e não com o `speakText` do TalkingHead — é que o
 * `speakText` faria uma SEGUNDA síntese de voz (Google TTS) para depois mexer
 * a boca. Isso traria: segunda chave, segunda conta, segundo custo por
 * carácter, e uma voz diferente da que o Dánio já afinou (`Aoede`, pt-PT).
 * Como o áudio do Gemini já está a tocar, analisá-lo é grátis e é a mesma voz.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARQUITECTURA
 * ─────────────────────────────────────────────────────────────────────────────
 * O TalkingHead corre em modo `avatarOnly`: ele NÃO cria cena, câmara, luzes
 * nem renderer — só a grelha de ossos e os morph targets. O `three` que já
 * existe no projecto (para os mapas 3D) desenha tudo. Isto evita ter dois
 * `WebGLRenderer` vivos ao mesmo tempo, que num telemóvel modesto (o alvo é
 * um Android de gama média em Luanda) é a diferença entre correr e não correr.
 *
 * O desenho pára sozinho quando não há nada a mostrar: sem fala, sem gesto e
 * com o painel fechado, o `requestAnimationFrame` é cancelado. Um avatar que
 * come bateria em silêncio é pior do que não ter avatar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ LICENÇA DO MODELO — LER ANTES DE TROCAR O FICHEIRO
 * ─────────────────────────────────────────────────────────────────────────────
 * O `kaze-avatar.glb` actual é o `mpfb.glb` do projecto TalkingHead, criado
 * com o MPFB (extensão do Blender) e licenciado **CC0** — domínio público.
 * Pode ser usado comercialmente, sem atribuição e sem pedir autorização.
 *
 * ⚠️ Os OUTROS avatares do repositório do TalkingHead NÃO são CC0:
 *   - `brunette.glb`  → CC BY-NC 4.0  → **PROIBIDO em uso comercial**
 *   - `vroid.glb`     → "non-commercial use"
 *   - `avaturn.glb`   → "non-commercial use"
 *   - `avatarsdk.glb` → "non-commercial use"
 * O Zenith Ride é um produto comercial. Trocar o `.glb` por qualquer um
 * destes quatro **é uma violação de licença**, mesmo numa demo a investidores.
 *
 * O caminho correcto para ter a cara própria do Kaze é criar um avatar em
 * `readyplayer.me` e apontar `KAZE_AVATAR_URL` para ele.
 *
 * Requisitos do `.glb` (nenhum é opcional):
 *   - node raiz chamado `Armature` (é o `modelRoot` por defeito do TalkingHead)
 *   - blend shapes `viseme_aa`, `viseme_E`, `viseme_I`, `viseme_O`, `viseme_U`,
 *     `viseme_PP`, `viseme_SS`, `viseme_TH`, `viseme_DD`, `viseme_FF`,
 *     `viseme_kk`, `viseme_nn`, `viseme_RR`, `viseme_CH` (visemes Oculus)
 *   - `eyeBlinkLeft` / `eyeBlinkRight` para o piscar de olhos
 *
 * O aviso de licença também aparece no painel (para o Dánio nunca ser
 * apanhado de surpresa numa demo) — ver `LICENCA_TEMPORARIA` mais abaixo.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TalkingHead } from '@met4citizen/talkinghead';
import { kazeDiag } from '../lib/kazeVoiceDiag';

/**
 * ⚠️ AVISO DE LICENÇA — manter a `true` enquanto o modelo for um dos avatares
 * de exemplo do repositório do TalkingHead. O painel mostra o aviso ao Dánio.
 *
 * Quando o avatar próprio (readyplayer.me) entrar, pôr a `false` e actualizar
 * a nota no `MEMORY.md` / `REFERENCIA-tecnica.md`.
 */
const LICENCA_TEMPORARIA = false;

/**
 * O modelo actual. Vem do `src/assets/kaze/` e o Vite trata-o como asset:
 * o URL final tem hash de conteúdo, por isso há cache de browser para sempre
 * e o `vercel.json` (CSP) não precisa de autorizar domínio nenhum externo.
 *
 * `new URL(..., import.meta.url)` é a forma que o Vite entende estaticamente —
 * não trocar por uma string concatenada, senão o ficheiro não é copiado.
 */
const KAZE_AVATAR_URL = new URL('../assets/kaze/kaze-avatar.glb', import.meta.url).href;

/** Telemóvel modesto: não vale a pena desenhar a 60 fps um busto parado. */
const FPS_OCIOSO = 24;
const FPS_A_FALAR = 30;

/**
 * Limiar de energia acima do qual a boca começa a abrir.
 *
 * O PCM sintetizado tem ruído de fundo, e o `getOutputLevel()` já corta em
 * 0.01 — mas em silêncio absoluto ainda pode oscilar. Abaixo deste valor
 * assume-se "não está a falar" e a boca fica fechada. Sem isto, o avatar
 * fica com a boca a tremer sozinho, que é o defeito clássico destes sistemas.
 */
const LIMIAR_ABERTURA = 0.045;

export interface KazeAvatarProps {
  /**
   * De onde ler a energia da voz. Vem do `kazeLiveClient.getOutputLevel()`.
   * Devolver sempre 0 é perfeitamente aceitável — o avatar fica parado com os
   * olhos a piscar em vez de avariar.
   */
  getOutputLevel: () => number;
  /** `true` enquanto o Kaze estiver a falar (vem do `onSpeakingChange`). */
  speaking: boolean;
  /** `true` enquanto o Kaze estiver a ouvir o utilizador. */
  listening?: boolean;
  /** Diâmetro visível do avatar, em px. */
  size?: number;
  /** Chamado quando o modelo falha (rede, ficheiro, blend shapes em falta). */
  onError?: (erro: string) => void;
}

const KazeAvatar: React.FC<KazeAvatarProps> = ({
  getOutputLevel,
  speaking,
  listening = false,
  size = 140,
  onError,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pronto, setPronto] = useState(false);
  const [falhou, setFalhou] = useState<string | null>(null);

  /**
   * As funções que mudam a cada render vivem numa ref. Sem isto, o efeito de
   * arranque (que carrega um GLB de ~36 MB) correria outra vez a cada mudança
   * de estado do chat — e o avatar recarregava o modelo a cada mensagem.
   */
  const getLevelRef = useRef(getOutputLevel);
  const speakingRef = useRef(speaking);
  const listeningRef = useRef(listening);
  getLevelRef.current = getOutputLevel;
  speakingRef.current = speaking;
  listeningRef.current = listening;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let vivo = true;
    let rafId = 0;
    let head: TalkingHead | null = null;
    let renderer: THREE.WebGLRenderer | null = null;

    /** Nível suavizado — evita que a boca vibre a cada bloco de áudio. */
    let nivelSuave = 0;
    /** Temporizador do piscar de olhos. */
    let proximoPiscar = performance.now() + 2500;
    let aPiscar = false;
    let piscarInicio = 0;

    const largura = canvas.clientWidth || size;
    const altura = canvas.clientHeight || size;

    const cena = new THREE.Scene();

    /**
     * Câmara de busto. O avatar do MPFB é de corpo inteiro e a escala é de
     * pessoa real (metros), por isso a câmara tem de estar perto. `fov` baixo
     * (28°) comprime a perspectiva e dá o efeito de retrato, que é o que se
     * quer num ícone pequeno.
     */
    const camera = new THREE.PerspectiveCamera(28, largura / altura, 0.1, 100);
    camera.position.set(0, 1.62, 0.62);

    // Luz: ambiente alto + direccional de cima à esquerda. Não há sombras —
    // num ícone de 140px não se notam e custam um render pass inteiro.
    cena.add(new THREE.AmbientLight(0xffffff, 2.2));
    const luzChave = new THREE.DirectionalLight(0xfff2d0, 2.4);
    luzChave.position.set(1.2, 2.4, 2.0);
    cena.add(luzChave);
    const luzFria = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    luzFria.position.set(-1.6, 1.0, -1.2);
    cena.add(luzFria);

    const arranque = async () => {
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
          // Um ícone não precisa de precisão máxima; `lowp` poupa bateria e
          // evita artefactos de banding em GPUs móveis antigas.
          precision: 'mediump',
          powerPreference: 'low-power',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(largura, altura, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        if (!vivo) return;

        /**
         * `avatarOnly: true` — o TalkingHead NÃO cria cena/câmara/renderer.
         * Passamos-lhe só a nossa câmara, para ele conseguir apontar a cabeça
         * na direcção certa quando faz contacto visual.
         */
        head = new TalkingHead(canvas, {
          avatarOnly: true,
          avatarOnlyCamera: camera,
          // O modelo é servido pelo nosso próprio domínio, logo não pode ler
          // ficheiros de fora — e não precisa.
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
        });

        kazeDiag('avatar:modelo_a_carregar', { url: KAZE_AVATAR_URL });

        await head.showAvatar({
          url: KAZE_AVATAR_URL,
          body: 'M',
          avatarMood: 'neutral',
          // ⚠️ 'en' de propósito: o TalkingHead não traz módulo de lip-sync
          // português (só de/en/fi/fr/lt). Como NÃO usamos `speakText` (o áudio
          // já vem sintetizado do Gemini), o módulo de língua só serve para dois
          // piscares de olhos automáticos. Escolher 'pt' deixaria o processor
          // como `undefined` e rebentava. Ver `lipsyncGetProcessor` no
          // talkinghead.mjs — o import dinâmico falha em silêncio.
          lipsyncLang: 'en',
          lipsyncModules: ['en'],
          // O MPFB tem a cabeça ligeiramente inclinada e as pálpebras cerradas
          // por defeito; estes dois valores abrem os olhos e endireitam-na.
          baseline: { headRotateX: -0.04, eyeBlinkLeft: 0.0, eyeBlinkRight: 0.0 },
          avatarMute: true,
        });

        if (!vivo) return;

        // O avatar nasce dentro do seu próprio `Armature`; penduramo-lo na cena.
        if (head.armature) {
          cena.add(head.armature);
        }

        /**
         * Enquadramento de busto. O MPFB está numa pose A; baixamos a raiz para
         * a cabeça cair no centro do quadro e aproximamos até encher o canvas.
         */
        if (head.armature) {
          head.armature.position.set(0, 0, 0);
          head.armature.rotation.set(0, 0, 0);
        }

        /**
         * A cabeça procura a câmara sozinha (é o contacto visual do TalkingHead)
         * mas a rotação vem alta para um busto fechado; corta-se para metade
         * para não parecer que está a olhar para o tecto.
         */
        head.opt.avatarIdleEyeContact = 0.35;
        head.opt.avatarSpeakingEyeContact = 0.55;
        head.opt.avatarIdleHeadMove = 0.25;
        head.opt.avatarSpeakingHeadMove = 0.45;

        // O TalkingHead em avatarOnly não corre o seu próprio loop: nós
        // chamamos-lhe o `animate(dt)` a cada frame. `start()` é preciso na
        // mesma para ele marcar `isRunning`.
        head.start();

        setPronto(true);
        kazeDiag('avatar:modelo_pronto', {
          visemes: head.visemeNames?.length ?? 0,
        });

        // ── Loop de desenho ────────────────────────────────────────────────
        let ultimoFrame = performance.now();
        let acumulado = 0;

        const desenhar = (agora: number) => {
          if (!vivo || !head || !renderer) return;
          rafId = requestAnimationFrame(desenhar);

          const dt = agora - ultimoFrame;
          ultimoFrame = agora;

          const fps = speakingRef.current ? FPS_A_FALAR : FPS_OCIOSO;
          const intervalo = 1000 / fps;
          acumulado += dt;
          // Salta frames em vez de desenhar a 60 fps um busto quase parado.
          if (acumulado < intervalo) return;
          const passo = acumulado;
          acumulado = 0;

          // 1. Energia da voz → abertura da boca.
          const bruto = speakingRef.current ? getLevelRef.current() : 0;
          // Suavização assimétrica: abre depressa (a consoante tem de aparecer
          // no sítio certo) e fecha devagar (evita o "estalar" da mandíbula).
          const alvo = bruto > LIMIAR_ABERTURA ? bruto : 0;
          const factor = alvo > nivelSuave ? 0.55 : 0.22;
          nivelSuave += (alvo - nivelSuave) * factor;
          if (nivelSuave < 0.005) nivelSuave = 0;

          aplicaNivel(head, nivelSuave, agora);

          // 2. Piscar de olhos — sem isto o avatar parece morto.
          //
          // Nota: o TalkingHead tem um `mtLimits.eyeBlink*` que mistura o
          // nosso valor com o `eyesLookDown` e o `browDown*` internos. Não
          // lutamos contra ele — escrevemos no mesmo canal (`fixed`) que tem
          // prioridade, e o limite só pode ABRIR mais, nunca fechar. O efeito
          // visível é o que queremos: pestaneja.
          if (!aPiscar && agora > proximoPiscar) {
            aPiscar = true;
            piscarInicio = agora;
            proximoPiscar = agora + 2200 + Math.random() * 3200;
          }
          if (aPiscar) {
            // 180 ms por piscar — abaixo disto não se vê, acima parece sono.
            const progresso = (agora - piscarInicio) / 180;
            const pisca = progresso < 1 ? Math.sin(progresso * Math.PI) : 0;
            defineMorph(head, 'eyeBlinkLeft', pisca);
            defineMorph(head, 'eyeBlinkRight', pisca);
            if (progresso >= 1) aPiscar = false;
          }

          // 3. Avançar a animação do TalkingHead com o tempo real.
          head.animate(passo);

          renderer.render(cena, camera);
        };

        rafId = requestAnimationFrame(desenhar);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // O caso mais provável de todos: o `.glb` foi trocado por um que não
        // tem os blend shapes. Vale a pena dizer isto em vez de "erro".
        kazeDiag('avatar:erro', { erro: msg });
        if (!vivo) return;
        setFalhou(msg);
        onError?.(msg);
      }
    };

    void arranque();

    return () => {
      vivo = false;
      cancelAnimationFrame(rafId);
      try {
        head?.stop();
      } catch {
        // Sair de cena com o áudio já fechado não é um erro que nos interesse.
      }
      try {
        renderer?.dispose();
      } catch {
        // idem
      }
    };
    // Intencional: só corre uma vez por montagem. As props vivas passam por ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: 'block',
          opacity: pronto ? 1 : 0,
          transition: 'opacity 420ms ease',
        }}
      />

      {/* Enquanto carrega: o emblema dourado que já existia, para não haver
          um buraco preto de 36 MB a descarregar. */}
      {!pronto && !falhou && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            className="material-symbols-outlined animate-pulse"
            style={{ color: 'var(--gold)', fontSize: '34px', opacity: 0.7 }}
          >
            auto_awesome
          </span>
        </div>
      )}

      {/* Falha: diz o que aconteceu e mantém o painel utilizável. Nunca
          esconder isto atrás de um ícone genérico — foi o que tornou o bug do
          Groq impossível de diagnosticar durante semanas. */}
      {falhou && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            textAlign: 'center',
          }}
        >
          <span className="material-symbols-outlined" style={{ color: 'var(--gold)', fontSize: '28px' }}>
            sentiment_dissatisfied
          </span>
          <span className="zr-meta" style={{ fontSize: '9px', opacity: 0.7, padding: '0 8px' }}>
            avatar indisponível
          </span>
        </div>
      )}

      {/* Aviso de licença — só aparece se o modelo não for o CC0. */}
      {LICENCA_TEMPORARIA && (
        <span
          className="zr-meta"
          style={{
            position: 'absolute',
            bottom: '2px',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: '8px',
            color: '#e2b04a',
            opacity: 0.85,
          }}
        >
          avatar temporário · não comercial
        </span>
      )}

      {/* halo dourado enquanto ouve — dá feedback de que o microfone está vivo */}
      {listening && (
        <span
          style={{
            position: 'absolute',
            inset: '-4px',
            borderRadius: '50%',
            border: '1px solid rgba(245, 215, 130, 0.45)',
            animation: 'kaze-halo 1.8s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
};

/**
 * Aplica o nível de energia aos visemes de vogal.
 *
 * Porque só às vogais: as consoantes (`PP`, `FF`, `SS`, `TH`, `kk`, `nn`,
 * `DD`, `CH`) fecham ou estreitam a boca, e abri-las com energia produziria
 * exatamente o contrário do que o som pede. As vogais é que abrem a mandíbula.
 */
function aplicaNivel(head: TalkingHead, nivel: number, agora: number): void {
  void agora;
  // `aa` é a vogal de boca mais aberta: é a que carrega a amplitude visível.
  const abertura = Math.min(1, nivel * 1.6);
  // Escala diagonal: misturar as vogais evita a boca a bater sempre no mesmo
  // sítio, que é o que faz um avatar parecer um boneco de madeira.
  const resto = abertura * 0.35;

  defineMorph(head, 'viseme_aa', abertura);
  defineMorph(head, 'viseme_E', resto);
  defineMorph(head, 'viseme_O', abertura * 0.45);
  defineMorph(head, 'viseme_I', resto * 0.6);
  defineMorph(head, 'viseme_U', resto * 0.4);
  // `jawOpen` dá o volume que os visemes sozinhos não dão.
  defineMorph(head, 'jawOpen', abertura * 0.55);
}

/**
 * Escreve um valor de morph target, à prova de bala.
 *
 * O `mtAvatar` é a estrutura interna do TalkingHead, indexada por nome de
 * blend shape. Escrever em `fixed` — e não em `realtime` ou `system` — é o
 * canal documentado no próprio código do TalkingHead como "Fixed value,
 * typically user controlled", e tem prioridade sobre tudo o resto em
 * `animate()`, incluindo animações. É por isso que a nossa boca ganha às
 * animações de fala do avatar.
 *
 * ⚠️ `needsUpdate` só se marca quando o valor muda de facto. Marcá-lo sempre
 * obrigaria o `animate()` a reprocessar o canal a cada frame — trabalho puro
 * desperdiçado, e no telemóvel nota-se.
 *
 * Se o nome não existir no modelo, a escrita é ignorada em silêncio de
 * propósito: um avatar sem `jawOpen` deve continuar a funcionar com os
 * visemes que tiver, em vez de rebentar a meio de uma demo.
 */
function defineMorph(head: TalkingHead, nome: string, valor: number): void {
  try {
    const alvo = head.mtAvatar?.[nome];
    if (!alvo) return;
    const limpo = Math.max(0, Math.min(1, valor));
    if (alvo.fixed === limpo) return;
    alvo.fixed = limpo;
    alvo.needsUpdate = true;
  } catch {
    // Um morph em falta não pode derrubar a conversa.
  }
}

export default KazeAvatar;
