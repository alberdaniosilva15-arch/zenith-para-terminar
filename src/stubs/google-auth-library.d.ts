// =============================================================================
// ZENITH RIDE v3.3 — src/stubs/google-auth-library.d.ts
//
// STUB DE TIPOS — não é código executável.
//
// PORQUÊ ISTO EXISTE
//   O SDK `@google/genai` traz, no seu ficheiro de tipos (`dist/genai.d.ts`),
//   esta linha:
//
//       import { GoogleAuthOptions } from 'google-auth-library';
//
//   A `google-auth-library` é uma biblioteca de **Node.js**. Ao ser arrastada
//   para o programa TypeScript, traz consigo os tipos globais do Node
//   (`@types/node`), que redefinem `setTimeout`/`setInterval` para devolverem
//   `NodeJS.Timeout` em vez de `number`.
//
//   Isso quebrava código de browser já existente e correcto — por exemplo
//   `KazePanel.tsx`, onde `useRef<ReturnType<typeof setTimeout>>` deixava de
//   casar com `window.setTimeout` (que devolve `number`).
//
// PORQUE É SEGURO
//   1. O bundle de browser do SDK (`dist/web/index.mjs`) NÃO importa esta
//      biblioteca — zero imports de `node:*`. Confirmado no pacote instalado.
//   2. O único uso deste tipo no SDK é a propriedade `googleAuthOptions`, cuja
//      própria documentação diz: "Only supported on Node runtimes, ignored on
//      browser runtimes."
//
//   Ou seja: num browser este tipo nunca é exercido. O stub existe apenas para
//   satisfazer o compilador e impedir que os tipos de Node contaminem o
//   programa. O `paths` correspondente está em `tsconfig.json`.
//
// NÃO apagar sem remover também a entrada `google-auth-library` de
// `compilerOptions.paths` no tsconfig.json.
// =============================================================================

/**
 * Stub permissivo de `GoogleAuthOptions`.
 *
 * A app corre exclusivamente no browser, onde esta configuração é ignorada pelo
 * SDK. Não precisamos da forma real — só de evitar que a biblioteca de Node
 * entre no programa de tipos.
 */
export interface GoogleAuthOptions {
  readonly [key: string]: unknown;
}
