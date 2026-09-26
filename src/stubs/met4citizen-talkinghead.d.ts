/**
 * Tipos do @met4citizen/talkinghead.
 *
 * O pacote (v1.7.0) é JavaScript puro e não publica `.d.ts` — sem isto, o
 * `tsc` recusa o import (`TS7016`) e o `strict` do projecto não deixa passar.
 *
 * ⚠️ Estes tipos cobrem SÓ o que o Zenith Ride usa. Não são a API completa do
 * TalkingHead — são a superfície que nos interessa, escrita a partir da
 * leitura do `talkinghead.mjs` instalado. Se um dia se chamar mais alguma
 * coisa, acrescentar aqui **e verificar no código do pacote**, não inventar.
 *
 * Ver em `node_modules/@met4citizen/talkinghead/modules/talkinghead.mjs`:
 *   - `showAvatar` ......... linha 1189
 *   - `setView` ............ linha 1417
 *   - `speakAudio` ......... linha 3041
 *   - `streamStart` ........ linha 3465
 *   - `startListening` ..... linha 4255
 *   - `animate` ............ linha 2336
 *   - `mtAvatar` ........... linha 685 (estrutura interna dos blend shapes)
 */
declare module '@met4citizen/talkinghead' {
  import type * as THREE from 'three';

  /**
   * Um blend shape individual na estrutura interna do TalkingHead.
   *
   * `fixed` é o canal de valor imposto por nós e tem prioridade sobre tudo o
   * resto em `animate()` (incluindo animações). É o único que devemos escrever.
   */
  export interface TalkingHeadMorphTarget {
    /**
     * Valor fixo, controlado pela aplicação. `null` devolve o controlo ao
     * TalkingHead. Só se escreve aqui.
     */
    fixed: number | null;
    /** Quando `true`, o `animate()` reprocessa este morph. */
    needsUpdate: boolean;
    /** Valor actualmente aplicado ao modelo. Só leitura, para diagnóstico. */
    value: number;
    system: number | null;
    systemd: number | null;
    realtime: number | null;
    newvalue: number | null;
    base: number | null;
    v: number;
    applied: number;
  }

  /**
   * Opções aceites no construtor. Lista parcial — só as que usamos.
   * A lista completa está em `this.opt` no pacote (linha 122).
   */
  export interface TalkingHeadOptions {
    /**
     * `true` não cria cena, câmara, luzes nem renderer — só a grelha de ossos
     * e os morph targets, para pendurar numa cena `three` já existente.
     * Ver Appendix H do README do pacote.
     */
    avatarOnly?: boolean;
    /** Câmara a que o avatar se liga, em modo `avatarOnly`. */
    avatarOnlyCamera?: THREE.Camera | null;
    /** Cena onde inserir o `Armature`, em modo `avatarOnly`. */
    avatarOnlyScene?: THREE.Scene | null;
    /** Nome do node raiz do avatar. Default: `"Armature"`. */
    modelRoot?: string;
    /** Módulos de lip-sync a carregar. Default: `['fi','en','lt']`. */
    lipsyncModules?: string[];
    /** Língua do lip-sync. Só existem módulos de/en/fi/fr/lt. */
    lipsyncLang?: string;
    /** Vista inicial: `full`, `mid`, `upper`, `head`. */
    cameraView?: 'full' | 'mid' | 'upper' | 'head';
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    avatarMood?: string;
    /** Silencia a síntese interna. Deixamos `true` — não geramos voz aqui. */
    avatarMute?: boolean;
    /** Frequência de actualização interna do TalkingHead. Default: 30. */
    modelFPS?: number;
    /** Contacto visual em repouso (0..1). */
    avatarIdleEyeContact?: number;
    /** Contacto visual enquanto fala (0..1). */
    avatarSpeakingEyeContact?: number;
    /** Movimento de cabeça em repouso (0..1). */
    avatarIdleHeadMove?: number;
    /** Movimento de cabeça enquanto fala (0..1). */
    avatarSpeakingHeadMove?: number;
    /** Chamado a cada passo de animação, em modo normal. */
    update?: ((dt: number) => void) | null;
    [key: string]: unknown;
  }

  /** Argumento de `showAvatar`. */
  export interface TalkingHeadAvatarConfig {
    /** URL do GLB. Obrigatório. */
    url: string;
    /** `"M"` ou `"F"`. Ajusta proporções internas de pose. */
    body?: 'M' | 'F';
    avatarMood?: string;
    avatarMute?: boolean;
    lipsyncLang?: string;
    /** Valores base de blend shapes, aplicados por cima de tudo. */
    baseline?: Record<string, number>;
    avatarIdleEyeContact?: number;
    avatarSpeakingEyeContact?: number;
    avatarIgnoreCamera?: boolean;
    [key: string]: unknown;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);

    /** Node do avatar carregado. `null` antes de `showAvatar`. */
    armature: THREE.Object3D | null;

    /**
     * Estrutura interna dos blend shapes, indexada por nome
     * (`viseme_aa`, `eyeBlinkLeft`, `jawOpen`, ...).
     */
    mtAvatar: Record<string, TalkingHeadMorphTarget>;

    /** Nomes dos 15 visemes Oculus suportados. */
    visemeNames: string[];

    /** As opções em uso. Mutável — é assim que se afina o comportamento. */
    opt: TalkingHeadOptions;

    /** `true` depois de `start()` e antes de `stop()`. */
    isRunning: boolean;

    /** Cena `three` interna. `null` em modo `avatarOnly`. */
    scene: THREE.Scene | null;

    /** Câmara `three` interna. `null` em modo `avatarOnly`. */
    camera: THREE.Camera | null;

    /** Carrega um avatar. Rejeita se faltarem o `modelRoot` ou os blend shapes. */
    showAvatar(avatar: TalkingHeadAvatarConfig, onprogress?: ((p: ProgressEvent) => void) | null): Promise<void>;

    /** Muda o enquadramento: `full`, `mid`, `upper` ou `head`. */
    setView(view: 'full' | 'mid' | 'upper' | 'head', opt?: Record<string, unknown> | null): void;

    /** Define o estado de ânimo. */
    setMood(mood: string): void;

    /**
     * Avança a animação.
     *
     * Em modo `avatarOnly` o argumento é o DELTA em ms, não o timestamp —
     * é o que o próprio pacote documenta na JSDoc (`In avatarOnly mode delta`).
     */
    animate(dt: number): void;

    /** Arranca o ciclo de animação interno. */
    start(): void;

    /** Pára e suspende o contexto de áudio. */
    stop(): void;

    /** Alimenta um `AnalyserNode` externo para o batimento da cabeça. */
    startListening(analyzer: AnalyserNode, opt?: Record<string, unknown>, onchange?: ((estado: string, ms: number) => void) | null): void;

    /** Para de ler o analisador externo. */
    stopListening(): void;

    /** Enfileira áudio já sintetizado (AudioBuffer ou PCM 16-bit LE). */
    speakAudio(
      audio: { audio: AudioBuffer | Int16Array | ArrayBuffer; words?: string[]; wtimes?: number[]; wdurations?: number[]; visemes?: string[]; vtimes?: number[]; vdurations?: number[] },
      opt?: Record<string, unknown> | null,
      onsubtitles?: ((texto: string) => void) | null
    ): void;

    /** Entra em modo de streaming de áudio. */
    streamStart(
      opt?: { sampleRate?: number; gain?: number; lipsyncType?: 'visemes' | 'blendshapes' | 'words'; lipsyncLang?: string; waitForAudioChunks?: boolean; mood?: string },
      onAudioStart?: (() => void) | null,
      onAudioEnd?: (() => void) | null,
      onSubtitles?: ((texto: string) => void) | null,
      onMetrics?: ((m: unknown) => void) | null
    ): Promise<void>;

    /** Envia um bloco de áudio em modo de streaming. */
    streamAudio(r: { audio?: Int16Array | ArrayBuffer; words?: string[]; wtimes?: number[]; wdurations?: number[]; visemes?: string[]; vtimes?: number[]; vdurations?: number[] }): void;

    /** Sai do modo de streaming. */
    streamStop(): void;
  }
}
