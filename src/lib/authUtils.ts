/**
 * Verifica se a URL actual contém tokens de recuperação de password ou confirmação de email
 * do Supabase, permitindo redireccionar o utilizador para o fluxo de reset.
 */
/**
 * Sanitiza um caminho de redirecionamento para prevenir open-redirect attacks.
 * Apenas aceita paths relativos que não apontem para caminhos perigosos.
 */
export function sanitizeRedirectTarget(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//')) return null;
  if (candidate.startsWith('/login')) return null;
  return candidate;
}

export function hasRecoveryType(search: string, hash: string): boolean {
  const searchParams = new URLSearchParams(search);
  if (searchParams.get('type') === 'recovery' || searchParams.get('type') === 'signup') return true;

  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!normalizedHash) return false;

  const hashParams = new URLSearchParams(normalizedHash);
  return (
    hashParams.get('type') === 'recovery' || 
    hashParams.get('type') === 'signup' ||
    hashParams.has('access_token')
  );
}
