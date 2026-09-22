// =============================================================================
// ZENITH RIDE — configuração do painel de administração
// =============================================================================
//
// ⚠️ ESTE FICHEIRO NÃO É SEGURANÇA. É cortesia.
//
// A regra "só o Dánio entra no painel" vive na BASE DE DADOS:
//   • tabela `public.admin_allowlist` — a lista de emails autorizados;
//   • gatilho `public.proteger_papel_admin` em `public.users` — impede que
//     qualquer outra conta receba `role = 'admin'`, venha de onde vier;
//   • políticas de RLS em `public.users` — só admins podem escrever lá.
//
// O que está aqui serve apenas para a interface dizer à pessoa, em português e
// antes de a deixar tentar, que aquela conta não é a certa — em vez de a mandar
// fazer um login para depois mostrar um erro seco. Se este ficheiro fosse
// apagado, ninguém entrava no painel sem ser o admin na mesma.
// =============================================================================

/** A única conta com acesso ao painel de administração. */
export const ADMIN_EMAIL = 'alberdaniosilva15@gmail.com';

/** Comparação de emails tolerante a maiúsculas e espaços. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === ADMIN_EMAIL;
}
