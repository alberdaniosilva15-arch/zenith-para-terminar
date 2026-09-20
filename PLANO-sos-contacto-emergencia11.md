# PLANO — SOS: do grito ao contacto de emergência

**Para:** Dánio  
**Data:** 20/09/2026  
**Estado:** proposta para aprovação — **nada foi implementado a partir deste plano**

> Este documento existe para ser lido antes de aprovar. Não é um resumo do que fiz:  
> é a análise do que está partido, com provas, e as decisões que só tu podes tomar  
> (canal, custo, dependência da Meta).

---


## 1. Sumário

O sistema de socorro **não está mal construído — está incompleto e desligado em quatro sítios**.

A escada automática (corrida a passar 1,5× o previsto → aviso na app → aviso ao admin →  
WhatsApp ao contacto) está escrita, revista e testada. O motor é bom. E há **prova de que já  
funcionou uma vez**: o alerta de 19/09 às 12:37 chegou ao contacto às 12:39, sem erro.

O que falha é tudo o que vem **antes** e **depois** desse envio:

1. **A gravação nunca fica ligada ao alerta** → mesmo que o WhatsApp saia, sai sem áudio.
2. **O link para o contacto é aberto numa altura em que o browser o bloqueia** → o grito  
   detectado automaticamente não abre nada.
3. **O grito só nasce quando um motorista aceita a corrida** → enquanto procuras carro, ou  
   simplesmente a andar a pé, não há detecção nenhuma. E a chamada automática só acontece  
   entre as 18h e as 5h. *(corrigido a teu pedido, 20/09 — ver F3)*
4. **O envio pelo servidor depende de uma janela de 24 h da Meta** → fora dela, recusa.
5. **A fila de alertas tem prazo de 30 minutos** → um alerta que não sai à primeira morre em  
   silêncio, sem nota e sem fechar. *(descoberta de hoje, ver F6)*

O ponto 2 é o que explica o teu "o grito existe mas não funciona". E é o mais barato de  
corrigir de todos.

O ponto 5 muda a conclusão do plano: o canal do servidor **não tem margem para tentar de  
novo**. Por isso o link pelo WhatsApp do próprio passageiro não é o plano B — é o caminho  
principal.

---


### Código 1 — Ligar a gravação ao alerta (corrige F1)

**`src/components/PanicButton.tsx`**

O problema é de **ordem**, e há três coisas que precisam de sítios diferentes:

1. O **alerta** tem de nascer **já** — é ele que existe, que aparece no painel, que o motor lê e  
   a que a gravação se vai ligar.
2. A **gravação** tem de começar **já** — os primeiros segundos do grito são os que interessam.
3. As **coordenadas** podem chegar **depois** — são um detalhe que se acrescenta à linha.

> ⚠️ **Correcção a este plano (revisão de 20/09).** A versão anterior punha o GPS **antes** do  
> alerta, com um `await`. Isso trocava um problema por outro: o alerta só nascia depois de o GPS  
> responder — **até 10 segundos**, o `timeout` do próprio `getCurrentPosition`. Num SOS isso não  
> se aceita. A ordem correcta é **alerta → gravação → coordenadas**.

```ts
// ── ANTES ────────────────────────────────────────────────────────────────
void startAudioRecording(silent);
activeAlertIdRef.current = null;
navigator.geolocation.getCurrentPosition(
  async (position) => {
    const { latitude, longitude } = position.coords;
    await persistPanic(latitude, longitude, silent ? 'critical' : 'high', source);
    sendEmergencyAlerts(latitude, longitude);
  },
  ...

// ── DEPOIS ───────────────────────────────────────────────────────────────
// 1. O ALERTA NASCE JÁ — sem esperar por GPS nenhum.
//    ⚠️ Um SOS que espera pelo satélite é um SOS que chega tarde. Se o GPS
//    demorar os 10 s do seu próprio timeout, o alerta demorava os mesmos 10 s
//    a existir. O alerta não pode depender de um detalhe que pode chegar depois.
const alertaId = await persistPanic(undefined, undefined, silent ? 'critical' : 'high', source);
activeAlertIdRef.current = alertaId;

// 2. A gravação arranca imediatamente e liga-se ao id que acabou de nascer.
void startAudioRecording(silent, Promise.resolve(alertaId));

// 3. As coordenadas entram quando chegarem — não bloqueiam nada nem ninguém.
void (async () => {
  const pos = await obterPosicao(3000);
  if (alertaId && pos.latitude != null && pos.longitude != null) {
    await supabase
      .from('panic_alerts')
      .update({ lat: pos.latitude, lng: pos.longitude })
      .eq('id', alertaId);
  }
  void sendEmergencyAlerts(pos.latitude, pos.longitude);
})();
```

E o `obterPosicao` com **tecto duplo** — o `timeout` das opções do browser **não é de  
confiança** (pode não disparar se o pedido ficar pendurado), por isso o `Promise.race`:

```ts
function obterPosicao(tectoMs: number): Promise<{ latitude?: number; longitude?: number }> {
  const semResposta = { latitude: undefined, longitude: undefined };
  return Promise.race([
    new Promise<{ latitude?: number; longitude?: number }>((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => resolve(semResposta),          // permissão negada ou erro
        { enableHighAccuracy: true, timeout: tectoMs, maximumAge: 15000 },
      ),
    ),
    // Tecto de segurança: mesmo que o browser ignore o `timeout`, seguimos.
    new Promise<{ latitude?: number; longitude?: number }>((resolve) =>
      setTimeout(() => resolve(semResposta), tectoMs),
    ),
  ]);
}
```

> ### O que se ganha e o que se perde — dito sem rodeios
>
> |                           | Antes (com `await` ao GPS) | Agora                                   |
> | ------------------------- | -------------------------- | --------------------------------------- |
> | O alerta existe em        | até **10 s**               | **menos de 1 s**                        |
> | Gravação ligada ao alerta | não (ia para `pending/`)   | sim                                     |
> | Coordenadas               | sempre presentes           | em ~1–3 s; se o GPS falhar, ficam nulas |
> | Aviso ao contacto         | atrasado com o GPS         | imediato, com ou sem coordenadas        |
>
> **O custo real, explícito:** durante ~1 a 3 segundos o alerta existe **sem coordenadas**. Se o  
> motor de escalonamento o apanhasse nesse instante, a mensagem sairia sem localização.
>
> **Não apanha — e isto não é fé, é código:** o motor só avisa depois de  
> `ESPERA_PARA_ANEXAR_AUDIO_MS = 45 s` (`logica.ts:365`), precisamente para dar tempo ao áudio  
> chegar. Três segundos cabem lá dentro com folga.
>
> ⚠️ **Risco residual honesto:** se algum dia alguém baixar esse `ESPERA_PARA_ANEXAR_AUDIO_MS`  
> para menos de 3 s, esta correcção **parte-se em silêncio** — a mensagem passa a sair sem  
> localização e nada avisa. Fica este número escrito aqui de propósito, para quem mexer nele  
> saber o que está a partir.
>
> **Se o GPS falhar de todo:** o alerta fica com `lat`/`lng` nulos e a mensagem vai sem  
> localização. É pior do que com localização, mas **muito melhor do que não haver alerta** — que  
> é exactamente o que acontece hoje.

````

E em `startAudioRecording`:

```ts
const startAudioRecording = async (silent: boolean, idDoAlerta?: Promise<string | null>) => {
  ...
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

    // Espera pelo id do alerta. Se já existir, resolve de imediato.
    const alertId = (await idDoAlerta?.catch(() => null)) ?? activeAlertIdRef.current;

    if (!alertId) {
      // Nunca gravar para 'pending': um ficheiro órfão não serve para nada e
      // nunca mais é encontrado. Melhor não guardar e deixar rasto.
      console.warn('[PanicButton] Audio sem alerta associado — nao guardado.');
      return;
    }

    const filename = `${userId}/${alertId}/panic_${Date.now()}.webm`;
    const { error: uploadError } = await supabase.storage
      .from('panic-audio')
      .upload(filename, blob, { contentType: 'audio/webm' });

    if (uploadError) throw uploadError;

    // ⚠️ Verificar o erro do UPDATE. Era aqui que falhava em silêncio: sem
    // `error` verificado, o ficheiro ficava no bucket e o alerta sem ponteiro.
    const { error: erroLigacao } = await supabase
      .from('panic_alerts')
      .update({ audio_storage_path: filename })
      .eq('id', alertId);

    if (erroLigacao) {
      console.error('[PanicButton] Audio gravado mas NAO ligado ao alerta:', erroLigacao);
    }
  };
````

> **Nota sobre permissões:** o `storage.objects` do bucket `panic-audio` precisa de permitir  
> `INSERT` em `${userId}/…`. Isso tem de ser verificado antes de assumir que o upload passa —  
> é a prova P1 em §8.

---

### Código 2 — O link para o contacto tem de abrir sempre (corrige F2)

> ⚠️ **Correcção a este plano (revisão de 20/09).** A versão anterior propunha  
> `window.location.href` como **caminho principal**. Estava mal, e por **duas** razões que eu  
> não vi:
>
> 1. **Sai da app.** Num web app, navegar para `wa.me` **destrói a sessão**. Numa emergência a  
>    sério o passageiro pode não voltar — e perde o botão de pânico, o rastreio e o estado da  
>    corrida.
> 2. **Mata a gravação.** ⚠️ O `MediaRecorder` vive **nesta** página. Navegar para fora  
>    **aborta a gravação** — que é a única prova do que se passou. Isto é o **oposto** do que o  
>    F1 tenta resolver: eu estava a corrigir o áudio num sítio e a destruí-lo no outro.
>
> O `<a href>` passa a **primeira** opção, não a rede de segurança.

#### 2a. O caminho principal — o `<a href>` (nunca é bloqueado)

```tsx
// src/components/PanicButton.tsx — no estado `sent`
{sosLink && (
  <a
    href={sosLink}
    target="_blank"
    rel="noopener noreferrer"
    className="zr-btn zr-btn--danger"
    style={{ width: '100%', justifyContent: 'center', fontWeight: 700 }}
  >
    🆘 Abrir WhatsApp para {emergencyPhone}
  </a>
)}
```

> Um `<a href>` verdadeiro **nunca** é bloqueado, seja qual for o momento em que o utilizador  
> toca. **E não sai da app** — o WhatsApp abre por cima, e a Zenith continua viva por baixo, a  
> gravar. É a única forma que não depende de política de browser nenhuma.

#### 2b. Quando se quer que abra sozinho: abrir a aba DENTRO do gesto

O problema do `window.open` não é o `window.open` — é ter perdido o gesto do utilizador. A  
correcção não é trocá-lo por uma navegação. É **abrir a aba no instante do toque, ainda vazia**,  
e só lhe dar o endereço depois. **Uma aba aberta durante um gesto fica autorizada para sempre.**

```ts
// Chamado DENTRO do onClick, SINCRONAMENTE, antes de qualquer `await`.
// A aba nasce aqui — é este o segredo. Tudo o resto pode esperar.
const janelaDoWhatsApp = window.open('', '_blank');

// ⚠️ `noopener` NÃO pode ir no `window.open` que queremos referenciar depois:
// com `noopener` o retorno é `null` e perdemos a aba. Corta-se o `opener` à mão,
// que dá o mesmo efeito de segurança sem perder a referência.
if (janelaDoWhatsApp) {
  try { janelaDoWhatsApp.opener = null; } catch { /* cross-origin, ignorado */ }
}
```

```ts
// ...depois dos awaits, quando o link já existe...
if (janelaDoWhatsApp && sosLink) {
  janelaDoWhatsApp.location.replace(sosLink);
} else {
  // Popup bloqueado pela política do browser → o botão <a href> de 2a fica
  // como única saída. O passageiro nunca fica sem nada para tocar.
  setMostrarBotaoDoLink(true);
}
```

> **O custo honesto desta técnica:** no telemóvel abre-se uma aba **em branco** e o browser  
> muda para ela durante um ou dois segundos, até o link ficar pronto. É feio. Num SOS, feio e  
> automático vale mais do que bonito e à espera de um toque. Mas fica dito.

#### 2c. O que **não** se faz, e porquê

```ts
// ❌ REJEITADO — e a razão fica escrita para não voltar:
// window.location.href = sosLink;
//   • aborta o MediaRecorder → perde-se a prova em áudio
//   • destrói a sessão do app numa emergência
//   • e não resolve o caminho automático: sem gesto, o browser não aceita
//     navegação nenhuma que ele próprio decida bloquear
```

#### 2d. E o grito automático? Uma verdade desconfortável

A revisão obrigou-me a encarar isto de frente: **sem um toque, não há forma de abrir o WhatsApp  
— e a única alternativa (`location.href`) mata a gravação.** Não há truque que resolva as duas  
coisas ao mesmo tempo. Sobram duas saídas honestas:

| Saída                                       | O que custa                                                   |
| ------------------------------------------- | ------------------------------------------------------------- |
| **Banner em ecrã inteiro** com o `<a href>` | só funciona se o passageiro olhar para o ecrã                 |
| **Canal do servidor** (Fase 2)              | depende da janela da Meta — mas **não precisa do app aberto** |

É por isto que o canal do servidor, na Fase 2, **não é um extra**: para o grito automático é o  
único caminho que não depende de alguém estar a olhar para o telemóvel. A Fase 1 e a Fase 2 não  
são alternativas — são as duas metades da mesma resposta.

⚠️ **E é por isto que a decisão 6 importa tanto:** se a chamada automática passar a acontecer a  
qualquer hora, ela passa a ser o **único** canal que actua sozinho sem depender de olhos nem da  
Meta. Deixa de ser um detalhe e passa a ser o pilar do caminho automático.

---

### Código 3 — Mensagem única para todos os canais

Hoje há duas mensagens diferentes: a do servidor (`montarMensagemDePanico`, rica, com matrícula  
e nome do motorista) e a do telemóvel (`buildEmergencyMessage`, pobre, só nome e coordenadas).  
**O contacto pode receber as duas** — e ficaria com informação contraditória.

Proposta: uma só fonte de verdade, com tudo o que pediste — **localização exacta, coordenadas,  
matrícula, nome do motorista, e o pedido de ligar ao passageiro**.

```ts
// src/lib/nativeEmergency.ts
export function buildEmergencyMessage(p: {
  nomePassageiro?: string;
  telefonePassageiro?: string;
  nomeMotorista?: string;
  marcaModelo?: string;
  cor?: string;
  matricula?: string;
  origem?: string;
  destino?: string;
  lat?: number;
  lng?: number;
  linkAudio?: string;
  automatico?: boolean;
}): string {
  const linhas: string[] = [
    '🆘 *ALERTA DE EMERGÊNCIA — ZENITH RIDE*',
    '',
    p.automatico
      ? 'O sistema detectou um pedido de socorro durante uma viagem.'
      : 'O passageiro accionou o botão de emergência.',
    '',
  ];

  if (p.nomePassageiro) linhas.push(`👤 *Passageiro:* ${p.nomePassageiro}`);
  if (p.nomeMotorista) linhas.push(`🚗 *Motorista:* ${p.nomeMotorista}`);

  const carro = [p.marcaModelo, p.cor].filter(Boolean).join(' · ');
  if (carro) linhas.push(`🚙 *Viatura:* ${carro}`);
  if (p.matricula) linhas.push(`🔖 *Matrícula:* ${p.matricula}`);

  if (p.origem || p.destino) {
    linhas.push('', `📍 *Viagem:* ${p.origem ?? '?'} → ${p.destino ?? '?'}`);
  }

  if (p.lat != null && p.lng != null) {
    linhas.push(
      '',
      `🗺️ *Localização exacta:*`,
      `https://maps.google.com/?q=${p.lat},${p.lng}`,
      `_(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})_`,
    );
  }

  if (p.linkAudio) {
    linhas.push('', `🎙️ *Gravação do momento:* ${p.linkAudio}`);
  }

  linhas.push('', '📞 *LIGA JÁ PARA O PASSAGEIRO* — não respondas por mensagem.');
  if (p.telefonePassageiro) {
    linhas.push(`☎️ ${p.telefonePassageiro}`);
  }
  linhas.push('', '_Zenith Ride — alerta automático de segurança_');

  return linhas.join('\n');
}
```

> O servidor continua a usar `montarMensagemDePanico` (já testada, com harness). O que muda é  
> que o lado do telemóvel deixa de ter uma mensagem **mais pobre** do que a do servidor.

---

### Código 4 — O grito armado desde a abertura do app (corrige F3)

*São **quatro** peças. Não dá para fazer isto com uma linha, porque o detector vive&#x20;*&#x68;oje dentro  
de um componente que só existe quando há corrida — tem de sair de lá.

#### 4.1 — O detector passa a poder separar o local do que vai à nuvem

```ts
// src/lib/screamDetector.ts
export interface OpcoesDetector {
  /**
   * Liga o wake-word por voz. ⚠️ `SpeechRecognition` com `continuous = true`
   * envia o áudio para os servidores da Google. Por isso é opcional e só se
   * liga quando há corrida — a detecção por amplitude é 100 % local e é essa
   * que fica sempre armada.
   */
  voz?: boolean;
}

// `onScream` passa a receber o motivo ("GRITO (Amplitude: 0.91)" / "WAKE-WORD ..."),
// para o registo dizer o que se passou e não só que se passou.
export function startScreamDetection(
  onScream: (motivo: string) => void,
  opcoes: OpcoesDetector = {},
): ScreamDetectorHandle | null {
  // ... corpo igual ...

  initAudio();                       // sempre — não sai do telemóvel
  if (opcoes.voz) initSpeech();      // só com corrida a decorrer

  // ...
}
```

Nota: `ScreamDetectorHandle` tem de passar a `export` (hoje é interno) e o `trigger()` passa a  
fazer `onScream(motivo)` em vez de `onScream()`.

#### 4.2 — O hook que mantém o grito armado

```ts
// src/hooks/useScreamGuard.ts  (novo)
import { useEffect, useRef } from 'react';
import { startScreamDetection, type ScreamDetectorHandle } from '../lib/screamDetector';

/**
 * Mantém o detector de grito armado desde que o app abre — não só durante a
 * corrida. Desarma quando o app vai para segundo plano: o browser suspende o
 * áudio de qualquer forma, e um microfone aberto sem ninguém a ver é bateria
 * gasta e falsos positivos.
 */
export function useScreamGuard(opcoes: {
  activo: boolean;            // sessão iniciada
  emCorrida: boolean;         // ACCEPTED | PICKING_UP | IN_PROGRESS
  aoDetectar: (motivo: string) => void;
}) {
  const { activo, emCorrida, aoDetectar } = opcoes;

  // O callback vive numa ref para o efeito não reiniciar a cada render —
  // reiniciar significa pedir o microfone outra vez, e o browser só deixa
  // conceder o `getUserMedia` uma vez por gesto.
  const callbackRef = useRef(aoDetectar);
  callbackRef.current = aoDetectar;

  useEffect(() => {
    if (!activo) return;

    let handle: ScreamDetectorHandle | null = null;

    const armar = () => {
      if (handle) return;
      handle = startScreamDetection(
        (motivo) => callbackRef.current(motivo),
        { voz: emCorrida },
      );
    };
    const desarmar = () => { handle?.stop(); handle = null; };

    const aoMudar = () => (document.hidden ? desarmar() : armar());
    document.addEventListener('visibilitychange', aoMudar);
    if (!document.hidden) armar();

    return () => {
      document.removeEventListener('visibilitychange', aoMudar);
      desarmar();
    };
  }, [activo, emCorrida]);
}
```

#### 4.3 — A janela de cancelamento (o que impede o falso SOS)

```tsx
// src/components/ScreamGuard.tsx  (novo)
const SEGUNDOS_DE_CANCELAMENTO = 15;

export default function ScreamGuard({ userId, rideId, emCorrida, emergencyPhone, driverName }) {
  const [pendente, setPendente] = useState<{ motivo: string; restam: number } | null>(null);

  useScreamGuard({
    activo: Boolean(userId),
    emCorrida,
    aoDetectar: (motivo) => setPendente({ motivo, restam: SEGUNDOS_DE_CANCELAMENTO }),
  });

  // Contagem decrescente. Só quando chega a zero é que o alerta sai mesmo.
  useEffect(() => {
    if (!pendente) return;
    if (pendente.restam <= 0) {
      void dispararPanico({ userId, rideId, emergencyPhone, driverName, source: 'grito' });
      setPendente(null);
      return;
    }
    const t = setTimeout(
      () => setPendente((p) => (p ? { ...p, restam: p.restam - 1 } : null)),
      1000,
    );
    return () => clearTimeout(t);
  }, [pendente, userId, rideId, emergencyPhone, driverName]);

  if (!pendente) return null;

  return (
    <div role="alert" className="zr-scream-guard">
      <strong>🆘 Ouvimos um pedido de ajuda</strong>
      <p>A enviar o alerta ao teu contacto em {pendente.restam}s.</p>
      <button type="button" onClick={() => setPendente(null)}>
        Não é nada — cancelar
      </button>
    </div>
  );
}
```

#### 4.4 — O disparo tem de sair de dentro do `PanicButton`

Hoje o `persistPanic` está **dentro** do `PanicButton` (linha 187), e o `PanicButton` só existe  
com corrida aceite. Para o grito funcionar sem corrida, o disparo tem de ser partilhado:

```ts
// src/lib/panicDispatcher.ts  (novo — extraído do PanicButton)
export interface PedidoDePanico {
  userId: string;
  rideId?: string;
  emergencyPhone?: string;
  driverName?: string;
  severity?: 'high' | 'critical';
  source: 'botao_panico' | 'grito' | 'escada_corrida';
}

/**
 * Cria o alerta, avisa o painel de admin em tempo real e devolve o id.
 * Resolve a posição aqui dentro (tecto de 3 s) para o chamador nunca ter de
 * esperar por GPS antes de pedir socorro.
 */
export async function dispararPanico(p: PedidoDePanico): Promise<string | null> { /* ... */ }
```

E o `PanicButton` passa a chamá-lo — deixando de ter a sua própria cópia.

#### 4.5 — Montagem, e as duas condições mortas que saem

```tsx
// src/app/AuthenticatedApp.tsx — sempre montado, dentro ou fora de corrida
<ScreamGuard
  userId={dbUser?.id}
  rideId={ride.rideId}
  emCorrida={ride.status === RideStatus.ACCEPTED
          || ride.status === RideStatus.PICKING_UP
          || ride.status === RideStatus.IN_PROGRESS}
  emergencyPhone={emergencyPhone}
  driverName={ride.driverName}
/>
```

```ts
// src/components/PanicButton.tsx

// SAI — o grito deixou de viver aqui (passou para o ScreamGuard)
useEffect(() => { if (!enableScreamDetection || !rideId) return; ... }, [...]);

// MUDA — a chamada automática deixa de escolher horas (era 18h–5h)
// ANTES:  if (isNightTime()) { setTimeout(() => makeEmergencyCall(emergencyPhone), 3000); }
setTimeout(() => makeEmergencyCall(emergencyPhone), 3000);
```

⚠️ **O `isNightTime()` fica sem uso** depois disto. Fui verificar se isso parte o build:  
**não parte.** O `tsconfig.json:17` tem `noUnusedLocals: false` e o ESLint tem o  
`@typescript-eslint/no-unused-vars` em **`warn`**, não em `error` (`.eslintrc.cjs:25`). Ainda  
assim, tira o `import` na mesma alteração: um import morto é exactamente a mesma armadilha do  
comentário da linha 72 que me fez escrever a versão errada deste plano.

**Efeito final:** abres o app → o detector de grito está armado. Não há corrida? Detecta e avisa  
na mesma (a mensagem vai sem motorista, porque não há nenhum). Há corrida? A mensagem leva  
motorista, matrícula e rota, e o wake-word por voz entra em jogo.

---

### Código 5 — Servidor: tentar texto livre, cair para modelo (corrige F5, opção C)

Só faz sentido **se decidires avançar com o modelo aprovado**. É o que faz o bot enviar sozinho,  
sem ninguém tocar em nada.

```ts
// supabase/functions/sos-escalation/index.ts
const WA_TEMPLATE_EMERGENCIA = Deno.env.get('WA_TEMPLATE_EMERGENCIA') ?? '';

async function enviarWhatsApp(telefone: string, texto: string): Promise<boolean> {
  const resposta = await postGraph(telefone, { type: 'text', text: { body: texto } });

  if (resposta.ok) return true;

  // 131047 = fora da janela de 24 h. É o caso normal: o contacto nunca nos
  // escreveu. Não é uma falha nossa — é uma regra da Meta.
  const foraDaJanela = resposta.codigo === 131047 || resposta.codigo === 470;

  if (foraDaJanela && WA_TEMPLATE_EMERGENCIA) {
    console.log('[sos-escalation] janela fechada — a usar modelo aprovado');
    return await enviarModelo(telefone, texto);
  }

  throw new Error(`graph API ${resposta.status}: ${resposta.detalhe}`);
}
```

O modelo (`utility`) tem de ser aprovado no painel da Meta com este corpo, por exemplo:

```
Alerta de emergência Zenith Ride.

Passageiro: {{1}}
Motorista: {{2}}
Matrícula: {{3}}
Localização: {{4}}

Ligue já para o passageiro.
```

> ⚠️ **Isto exige acção tua no painel da Meta** — criar e submeter o modelo. Não é código.  
> Até estar aprovado, o `WA_TEMPLATE_EMERGENCIA` fica vazio e o comportamento é o de hoje.

---

## 8. Migração de base de dados

Uma só, pequena. Serve para saber **por que canal** cada alerta saiu — sem isso não se  
consegue provar que a cascata funciona.

```sql
-- supabase/migrations/20260921000000_sos_canais_do_alerta.sql

ALTER TABLE public.panic_alerts
  ADD COLUMN IF NOT EXISTS canais_tentados TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS canal_que_passou TEXT,
  ADD COLUMN IF NOT EXISTS audio_bytes BIGINT;

COMMENT ON COLUMN public.panic_alerts.canais_tentados IS
  'Canais por onde se tentou avisar o contacto, por ordem (ex.: {cliente,servidor}).';
COMMENT ON COLUMN public.panic_alerts.canal_que_passou IS
  'Qual dos canais conseguiu entregar. NULL = nenhum ainda.';

-- Índice para o painel de admin filtrar alertas sem entrega.
CREATE INDEX IF NOT EXISTS idx_panic_alerts_sem_entrega
  ON public.panic_alerts (created_at DESC)
  WHERE contact_notified_at IS NULL;
```

---

## 9. Ordem de execução e como se prova

### Quanto tempo isto leva

Estimativas de **trabalho meu**, separadas daquilo que eu **não** controlo. É essa separação  
que decide, não o número final.

| Fase                               | Esforço meu                             | Espera que não controlo                 | Total realista     |
| ---------------------------------- | --------------------------------------- | --------------------------------------- | ------------------ |
| **1** — as 7 correcções            | **1 sessão** (2–3 h de código + provas) | nenhuma                                 | **1 dia**          |
| **2** — modelo + queda para modelo | **~1 h** de código                      | **aprovação da Meta: 1 a 7 dias**       | **1 a 7 dias**     |
| **3** — SMS pago                   | **~2 h** + configuração                 | contratação e verificação do fornecedor | **dias a semanas** |

**Onde está o tempo a sério:** não é no código. A Fase 1 é uma sessão de trabalho. As Fases 2 e  
3 estão presas em terceiros — a Meta a aprovar um modelo, um fornecedor a verificar uma conta.  
**É por isso que a Fase 1, sozinha, já resolve o teu problema hoje**, e as outras duas não a  
devem atrasar.

E o custo que não é tempo: **a Fase 1 não tem custo nenhum.** Nenhuma mensagem paga, nenhuma  
subscrição, nenhuma dependência de terceiros. É a única fase que se pode aprovar sem pensar em  
dinheiro.

### Fase 1 — sem custos, sem depender da Meta *(resolve o teu problema hoje)*

| # | O quê                                                               | Corrige |
| - | ------------------------------------------------------------------- | ------- |
| 1 | Ligar a gravação ao alerta                                          | F1      |
| 2 | Abrir o link de forma não bloqueável + botão visível                | **F2**  |
| 3 | Mensagem única e completa                                           | —       |
| 4 | Grito armado **desde a abertura do app** (sem esperar por corrida)  | **F3**  |
| 5 | Migração dos canais                                                 | —       |
| 6 | Alargar a fila de 30 min para 6 h e registar a desistência com nota | **F6**  |
| 7 | Fecho automático de alertas órfãos às 6 h                           | F7      |

### Fase 2 — depende da Meta *(faz o bot enviar sozinho)*

| #  | O quê                                             | Depende de            |
| -- | ------------------------------------------------- | --------------------- |
| 8  | Criar e submeter o modelo `utility`               | Tu, no painel da Meta |
| 9  | Código 5 — cair para modelo quando a janela fecha | 8 estar aprovado      |
| 10 | Enviar a gravação como mensagem de voz real       | janela aberta         |

### Fase 3 — decisão de custo *(só se quiseres)*

| #  | O quê                                                  | Nota                                                          |
| -- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 11 | SMS por fornecedor externo (Africa's Talking / Twilio) | Único canal que funciona **sem internet** do lado do contacto |

### Provas que vou correr antes de dizer "está feito"

| #       | Prova                                                        | Como                                                                                                                                             |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1**  | O upload do áudio passa e liga ao alerta                     | Alerta real + `select audio_storage_path, audio_bytes` — deixa de ser `null`                                                                     |
| **P2**  | O link abre no telemóvel                                     | Alerta real + confirmar que o WhatsApp abre com a mensagem                                                                                       |
| **P3**  | A escada sobe os degraus                                     | Corrida de teste com `started_at` antigo → ver `ride_safety_checks` a mudar de estado                                                            |
| **P4**  | O grito cria alerta `source='grito'` **sem corrida nenhuma** | Abrir o app sem corrida, gritar → `select source, ride_id from panic_alerts` → `grito` com `ride_id` nulo                                        |
| **P4b** | A chamada automática já não escolhe horas                    | Repetir o teste às 11h da manhã (era impossível antes das 18h)                                                                                   |
| **P4c** | O falso positivo é cancelável                                | Falar alto de propósito → aparece a contagem e o alerta **não** sai se carregares em cancelar                                                    |
| **P5**  | O modelo envia fora da janela                                | `contact_last_error` fica `null` num número que nunca escreveu ao bot                                                                            |
| **P6**  | A fila já não mata alertas em 30 min                         | Alerta de teste com número inválido → continua na fila aos 40 min e acaba com `contact_last_error` a dizer o motivo, em vez de ficar em silêncio |
| **P7**  | Os alertas órfãos fecham sozinhos                            | `select status, resolved_at from panic_alerts` → o alerta de 11/09 passa a `false_alarm` com nota                                                |

---

## 10. O que preciso que decidas

**1. Modelo aprovado na Meta (Fase 2).**  
Queres que avance com o pedido de modelo `utility`? Sem ele, o bot **nunca** consegue avisar  
sozinho quem não lhe escreveu nas últimas 24 h. Com ele, consegue sempre — mas custa dinheiro  
por mensagem fora da janela, e a aprovação não é instantânea.

**2. SMS pago (Fase 3).**  
O único canal que chega a um telemóvel **sem internet**. Numa emergência real, a rede de dados  
pode não estar lá. Queres orçamento? Se sim, prefiro Africa's Talking (tem cobertura em Angola)  
a Twilio.

**3. O contacto deve poder responder ao bot?**  
Se o contacto responder ao alerta, a janela abre 24 h e o bot passa a pode&#x72;*&#x20;falar com ele  
livremente nesse período. Útil, mas é uma decisão de privacidade — passa a haver uma*~~*&#x20;*~~*conversa*  
entre a Zenith e um terceiro.

**4. A escada dos 1,5× fica como está?**  
Nunca correu (F4). Proponho prová-la com uma corrida de teste antes de mexer em nada. Se  
estiver boa, não se toca.

**5. O wake-word por voz fica sempre ligado?** *(nova — 20/09)*  
A detecção de grito por **amplitude** é 100 % local e fica armada desde a abertura do app —  
isso já está decidido no plano, foi o que pediste. O **wake-word** ("socorro", "ajuda") é outra  
coisa: usa o `SpeechRecognition` do browser, que **envia o áudio do microfone para os servidores  
da Google**, continuamente. Proponho ligá-lo **só durante a corrida**, quando há mesmo alguém a  
ouvir-te e a frase faz sentido. Se preferires as duas sempre ligadas, faço — mas quero que seja  
uma escolha tua, não um efeito lateral que descobres depois.

**6. A chamada automática passa a acontecer a qualquer hora?** *(nova — 20/09)*  
Hoje só liga entre as 18h e as 5h (`isNightTime()`). Com o resto a funcionar a qualquer hora,  
deixar a chamada presa à noite é uma inconsistência — num assalto às 11h o contacto recebia  
texto e não uma chamada. Proponho remover o portão da hora. **Atenção:** uma chamada automática  
é intrusiva; se um falso positivo passar, o contacto recebe uma chamada e não só uma mensagem.  
É por isso que a janela de cancelamento (F3.1) deixa de ser opcional assim que esta decisão for  
"sim".

---

## 11. O que **não** proponho, e porquê

- **Fingir no código que o contacto escreveu.** Não abre a janela — a Meta não olha para o  
  nosso estado interno. Daria a ilusão de estar resolvido e falharia no momento em que  
  interessa.
- **Enviar SMS "pela" API do WhatsApp.** Não existe. A Cloud API só fala WhatsApp.
- **Guardar o áudio no telemóvel e enviar depois.** Se o telemóvel for perdido ou apreendido —  
  que é o cenário de uma emergência a sério — o áudio vai com ele. O bucket privado com link  
  assinado é o sítio certo.
- **Encurtar a retenção dos 7 dias do áudio.** Um caso de violência pode levar mais de uma  
  semana a chegar a tribunal. Sete dias já é o mínimo defensável; menos não.
- **Navegar para fora da app (`window.location.href`) no socorro.** Aborta o `MediaRecorder` —  
  destrói a gravação que o F1 existe exactamente para salvar — e mata a sessão a meio de uma  
  emergência. A aba pré-aberta dentro do gesto (§2b) resolve o mesmo sem esse preço.
- **Exigir confirmação do passageiro para o SOS sair.** Num grito com o telemóvel no bolso não  
  há quem confirme, e o socorro não sairia. A janela de 15 s é de **cancelamento**, não de  
  confirmação — a diferença parece pequena e é a diferença entre funcionar e não funcionar.

---

*Fim. **Nada disto foi implementado.** A Fase 1 é uma sessão de trabalho, não tem custo nenhum e  
não depende de terceiros — é por aí que se começa. Diz o que aprovas, e o que respondes às seis  
decisões do §10.*
