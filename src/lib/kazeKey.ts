// =============================================================================
// ZENITH RIDE — kazeKey.ts
//
// ⚠️ ESTE FICHEIRO JÁ FOI UM SEGREDO EXPOSTO. O que estava aqui, e porquê:
//
// A versão anterior tinha uma chave do Groq **hardcoded** em `_ZK_CIPHER`,
// guardada como números XOR-42, com um comentário a dizer que servia para
// funcionar "sem accionar as regras de varrimento do repositório". Ou seja: uma
// chave real, deliberadamente ofuscada para escapar ao detector de segredos do
// GitHub. Estava commitada E ia no bundle público.
//
// Pior ainda: as leituras usavam `import.meta.env?.GROQ_API_KEY` com optional
// chaining. O Vite não consegue substituir a propriedade estaticamente nesse
// caso, por isso inlinava o objecto `import.meta.env` INTEIRO — e com ele todos
// os segredos com prefixo, incluindo o `RESEND_API_KEY` (a chave de email).
//
// ── A regra que passa a valer ───────────────────────────────────────────────
// Nada que venha daqui pode ser um segredo. Estas funções devolvem **sempre
// string vazia**, e os caminhos que as usam caem para as rotas de servidor, que
// é onde as chaves vivem:
//
//   • transcrição de voz  → Edge Function `gemini-proxy`, acção `kaze_transcribe`
//   • fala do Kaze        → Edge Function `gemini-proxy`, acção `kaze_tts`
//   • conversa do Kaze    → Edge Function `gemini-proxy`, acção `kaze_chat`
//
// As chaves estão nos secrets das Edge Functions (Supabase) e nas variáveis de
// ambiente do Vercel. Nunca no `src/`.
// =============================================================================

/**
 * Chave do Groq para o browser.
 *
 * ⚠️ Devolve sempre vazio, de propósito. Existia para a transcrição de voz, que
 * passou a ser feita no servidor (`kaze_transcribe`). Ver o bloco acima.
 */
export function getResolvedKazeGroqKey(): string {
  return '';
}

/**
 * Chave do OpenRouter para o browser.
 *
 * ⚠️ Devolve sempre vazio, de propósito. A rota directa do cliente existia como
 * terceira alternativa; fica no servidor.
 */
export function getResolvedKazeOpenRouterKey(): string {
  return '';
}
