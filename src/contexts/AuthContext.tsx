// =============================================================================
// ZENITH RIDE v3.1 â€” AuthContext
// FIXES v3.1:
//   1. loadUserData: retries aumentados de 3 â†’ 5 (delay atÃ© 4.8s)
//   2. CORREÃ‡ÃƒO BUG 11: loadUserData agora usa while loop para retry,
//      garantindo que a Promise sÃ³ resolve APÃ“S todos os retries terminarem
//      (elimina race condition com init())
// =============================================================================

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { DbUser, DbProfile, AppError } from '../types';
import { UserRole } from '../types';
import { useAppStore } from '../store/useAppStore';

const CLIENT_ONLY_STORAGE_KEYS = [
  'zenith-ride-store-v3',
  'oauth_role_intent',
  'zenith_ia_provider',
  'zenith_ia_model',
];

function clearBrowserAuthStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }

  clearKnownStorage(window.localStorage);
  clearKnownStorage(window.sessionStorage);
}

function clearKnownStorage(storage: Storage): void {
  for (const key of CLIENT_ONLY_STORAGE_KEYS) {
    storage.removeItem(key);
  }

  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }

    if (isSupabaseAuthStorageKey(key)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    storage.removeItem(key);
  }
}

function isSupabaseAuthStorageKey(key: string): boolean {
  return (
    /^sb-.*-auth-token$/.test(key) ||
    key.startsWith('supabase.auth.') ||
    key.includes('-auth-token')
  );
}

// =============================================================================
// TIPOS DO CONTEXTO
// =============================================================================

interface AuthContextValue {
  session:   Session | null;
  authUser:  User | null;         // auth.users do Supabase
  dbUser:    DbUser | null;       // public.users (inclui role)
  profile:   DbProfile | null;
  role:      UserRole;
  loading:   boolean;
  authError: AppError | null;
  clearAuthError: () => void;

  // AcÃ§Ãµes
  signIn:      (email: string, password: string) => Promise<AppError | null>;
  signInWithGoogle: (role: UserRole) => Promise<AppError | null>;
  signUp:      (email: string, password: string, name: string, role: UserRole) => Promise<AppError | null>;
  signOut:     () => Promise<void>;
  updateProfile: (data: Partial<Pick<DbProfile, 'name' | 'avatar_url' | 'phone'>>) => Promise<AppError | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session,  setSession]  = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [authError, setAuthError] = useState<AppError | null>(null);

  // ZUSTAND STATE
  const dbUser = useAppStore(s => s.dbUser);
  const profile = useAppStore(s => s.profile);
  const setUser = useAppStore(s => s.setUser);
  const clearUser = useAppStore(s => s.clearUser);
  const updateProfileStore = useAppStore(s => s.updateProfile);
  const isInitRef = useRef(false);
  const pendingAuthEventRef = useRef<{ event: string; newSession: Session | null } | null>(null);
  const syncedDbUserIdRef = useRef<string | null>(null);

  const clearSyncedUserState = useCallback(() => {
    syncedDbUserIdRef.current = null;
    clearUser();
  }, [clearUser]);

  const syncSessionBoundary = useCallback((nextSession: Session | null) => {
    const nextUserId = nextSession?.user?.id ?? null;
    const hasSwitchedUser = syncedDbUserIdRef.current !== nextUserId;

    if (hasSwitchedUser) {
      clearSyncedUserState();
    }

    setSession(nextSession);
    setAuthUser(nextSession?.user ?? null);

    if (hasSwitchedUser && nextUserId) {
      setLoading(true);
    }

    return { nextUserId, hasSwitchedUser };
  }, [clearSyncedUserState]);

  const purgeClientSession = useCallback(() => {
    setSession(null);
    setAuthUser(null);
    clearSyncedUserState();
    setAuthError(null);
    setLoading(false);
    clearBrowserAuthStorage();
  }, [clearSyncedUserState]);

  // ------------------------------------------------------------------
  // Carregar dados do utilizador a partir do ID do Supabase Auth
  // Tem retry automÃ¡tico (5 tentativas, 600ms entre cada) para lidar com
  // a race condition entre o trigger handle_new_user e o signIn/signUp.
  // CORREÃ‡ÃƒO BUG 11: Promise encadeada correctamente â€” nÃ£o resolve antes dos retries
  // ------------------------------------------------------------------
  const loadUserData = useCallback(async (userId: string, attempt = 0): Promise<void> => {
    const MAX_ATTEMPTS = 4;
    const BASE_DELAY_MS = 250;

    while (attempt < MAX_ATTEMPTS) {
      try {
        console.log(`[AuthContext] loadUserData attempt ${attempt + 1}/${MAX_ATTEMPTS} for ${userId}`);
        
        const [{ data: userRow, error: userErr }, { data: profileRow, error: profErr }] =
          await Promise.all([
            supabase.from('users').select('*').eq('id', userId).maybeSingle(),
            supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
          ]);

        if (userErr) {
          if (isPermissionError(userErr)) {
            throw new Error('Sem permissÃ£o para carregar dados do utilizador. Contacte o suporte.');
          }
          throw userErr;
        }
        if (profErr) {
          if (isPermissionError(profErr)) {
            throw new Error('Sem permissÃ£o para carregar perfil. Contacte o suporte.');
          }
          throw profErr;
        }

        // Google OAuth Role Intent Resolution
        const intent = localStorage.getItem('oauth_role_intent');
        let finalUserRow = userRow;
        if (intent === 'driver' && finalUserRow && (finalUserRow as DbUser).role === 'passenger') {
          console.log('[AuthContext] Promovendo passenger a driver via OAuth intent');
          await supabase.rpc('set_my_role_driver');
          localStorage.removeItem('oauth_role_intent');
          const { data: updatedUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
          if (updatedUser) finalUserRow = updatedUser;
        }

        if (!finalUserRow) {
          // AUTO-REPAIR: Se o trigger handle_new_user falhou, criar os registos manualmente
          if (attempt < MAX_ATTEMPTS - 1) {
            console.warn('[AuthContext] Utilizador não encontrado — a tentar auto-repair via ensure_user_exists');
            const { data: { user: authU } } = await supabase.auth.getUser();
            if (authU) {
              const metaName = (authU.user_metadata?.name as string) ?? '';
              const metaRole = (authU.user_metadata?.role as string) ?? 'passenger';
              const { error: ensureErr } = await supabase.rpc('ensure_user_exists', {
                p_user_id: authU.id,
                p_email: authU.email ?? '',
                p_name: metaName,
                p_role: metaRole,
              });
              if (ensureErr) console.warn('[AuthContext] ensure_user_exists falhou:', ensureErr);
            }
            throw new Error('Auto-repair executado — a reententar carregamento...');
          }
          throw new Error('Dados do utilizador não encontrados. Contacta o suporte.');
        }

        const rawRole = (finalUserRow as { role?: unknown }).role;
        if (!isValidUserRole(rawRole)) {
          throw new Error(`Role invÃ¡lido recebido da BD: ${String(rawRole ?? 'null')}`);
        }

        const suspendedUntil = (finalUserRow as { suspended_until?: string | null }).suspended_until ?? null;
        if (isSuspended(suspendedUntil)) {
          clearSyncedUserState();
          setAuthError({
            code: 'account_suspended',
            message: formatSuspendedMessage(suspendedUntil),
            details: suspendedUntil,
          });
          setLoading(false);
          return;
        }

        // âœ… BUG #6 CORRIGIDO: effectiveUser Ã© sempre o finalUserRow real
        // O ?? foi removido porque era cÃ³digo morto e enganoso
        const effectiveUser: DbUser = {
          ...(finalUserRow as DbUser),
          role: rawRole,
        };

        const effectiveProfile: DbProfile = profileRow ?? {
          id: userId,
          user_id: userId,
          name: 'Utilizador',
          avatar_url: null,
          bio: null,
          phone: null,
          rating: 5.0,
          total_rides: 0,
          phone_privacy: false,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          level: 'Novato' as const,
          km_total: null,
          km_to_next_perk: null,
          free_km_available: null,
          last_known_lat: null,
          last_known_lng: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        syncedDbUserIdRef.current = effectiveUser.id;
        setUser(effectiveUser, effectiveProfile);
        setAuthError(null);
        setLoading(false);
        return; // Sucesso - sai da funÃ§Ã£o
      } catch (err: any) {
        console.warn(`[AuthContext] loadUserData attempt ${attempt + 1} falhou:`, err.message);
        if (attempt < MAX_ATTEMPTS - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`[AuthContext] Retry ${attempt + 2}/${MAX_ATTEMPTS} em ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          attempt++;
        } else {
          console.error('[AuthContext] Todos os retries falharam:', err);
          
          clearSyncedUserState();
          setAuthError({
            code: 'db_user_sync_failed',
            message: 'Não foi possível sincronizar a tua conta com a base de dados. Tenta novamente ou volta ao login.',
            details: err instanceof Error ? err.message : String(err ?? 'unknown'),
          });
          setLoading(false);
          return;
        }
      }
    }
  }, [setUser, clearSyncedUserState]);

  // ------------------------------------------------------------------
  // Inicializar: recuperar sessÃ£o existente + subscrever a mudanÃ§as
  // ------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      console.log('[AuthContext] init');
      // 1) Tentar detectar sessÃ£o diretamente a partir da URL (link mÃ¡gico)
      try {
        console.log('[AuthContext] checking getSessionFromUrl');
        if (typeof (supabase.auth as any).getSessionFromUrl === 'function') {
          const res = await (supabase.auth as any).getSessionFromUrl();
          const urlSession = res?.data?.session;
          console.log('[AuthContext] urlSession:', urlSession);
          if (!mounted) return;
          if (urlSession?.user) {
            syncSessionBoundary(urlSession);
            setAuthError(null);
            await loadUserData(urlSession.user.id);
            setLoading(false);
            isInitRef.current = true;
            // process pending auth event if any
            const pending = pendingAuthEventRef.current;
            pendingAuthEventRef.current = null;
            if (pending && mounted) {
              // Ignorar se Ã© o mesmo utilizador jÃ¡ carregado (evita double-load)
              const sameUserId = pending.newSession?.user?.id === urlSession?.user?.id;
              if (!sameUserId) {
                syncSessionBoundary(pending.newSession);
                if (pending.newSession?.user) {
                  setAuthError(null);
                  await loadUserData(pending.newSession.user.id);
                } else {
                  clearSyncedUserState();
                }
                setLoading(false);
              }
            }
            return;
          }
        }
      } catch (e) {
        // NÃ£o bloquear; prosseguir para getSession normal
        console.warn('[AuthContext] getSessionFromUrl falhou:', e);
      }

      // 2) Fallback: recuperar sessÃ£o existente (localStorage)
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      console.log('[AuthContext] initialSession:', initialSession);

      if (!mounted) return;

      if (initialSession?.user) {
        syncSessionBoundary(initialSession);
        setAuthError(null);
        await loadUserData(initialSession.user.id);
      }

      setLoading(false);
      isInitRef.current = true;
      const pending = pendingAuthEventRef.current;
      pendingAuthEventRef.current = null;
      if (pending && mounted) {
        // Ignorar se Ã© o mesmo utilizador jÃ¡ carregado (evita double-load)
        const sameUserId = pending.newSession?.user?.id === initialSession?.user?.id;
        if (!sameUserId) {
          syncSessionBoundary(pending.newSession);
          if (pending.newSession?.user) {
            setAuthError(null);
            await loadUserData(pending.newSession.user.id);
          } else {
            clearSyncedUserState();
          }
          setLoading(false);
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log('[AuthContext] onAuthStateChange', event, newSession);
        if (!mounted) return;

        // If init() hasn't finished, queue the event to avoid parallel loadUserData
        if (!isInitRef.current) {
          console.log('[AuthContext] onAuthStateChange queued until init completes');
          pendingAuthEventRef.current = { event, newSession };
          return;
        }

        syncSessionBoundary(newSession);

        if (newSession?.user) {
          setAuthError(null);
          await loadUserData(newSession.user.id);
        } else {
          clearSyncedUserState();
          setAuthError(null);
        }

        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserData, syncSessionBoundary, clearSyncedUserState]);

  // ------------------------------------------------------------------
  // SIGN IN
  // ------------------------------------------------------------------
  const signIn = useCallback(async (
    email: string,
    password: string
  ): Promise<AppError | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return {
        code: error.message,
        message: translateAuthError(error.message),
      };
    }
    return null;
  }, []);

  // ------------------------------------------------------------------
  // SIGN IN WITH GOOGLE
  // ------------------------------------------------------------------
  const signInWithGoogle = useCallback(async (role: UserRole): Promise<AppError | null> => {
    try {
      localStorage.setItem('oauth_role_intent', role);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          queryParams: { role },
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      return { code: 'google_auth_failed', message: translateAuthError(e.message) || 'Erro ao ligar com Google.' };
    }
  }, []);

  // ------------------------------------------------------------------
  // SIGN UP
  // ------------------------------------------------------------------
  const signUp = useCallback(async (
    email: string,
    password: string,
    name: string,
    role: UserRole
  ): Promise<AppError | null> => {
    // 1. Criar conta no Supabase Auth
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role },  // Role enviado nos metadados para o trigger handle_new_user
      },
    });

    if (signUpError) {
      return { code: signUpError.message, message: translateAuthError(signUpError.message) };
    }

    // Role assignment is handled server-side by the `handle_new_user` trigger.

    return null;
  }, []);

  // ------------------------------------------------------------------
  // SIGN OUT
  // ------------------------------------------------------------------
  const signOut = useCallback(async () => {
    try {
      // 1. Marcar que estamos a fazer signOut (previne re-autenticaÃ§Ã£o pelo listener)
      pendingAuthEventRef.current = null;
      isInitRef.current = false; // Bloqueia o listener de re-autenticar

      // 2. Limpar a sessÃ£o local imediatamente para a UI largar a conta antiga.
      purgeClientSession();

      // 3. Pedir ao Supabase para esquecer a sessÃ£o apenas neste dispositivo.
      await supabase.auth.signOut({ scope: 'local' });

      // 4. ReforÃ§ar a limpeza no browser e abrir o login num estado fresco.
      clearBrowserAuthStorage();
      window.location.replace('/login?cleared=1');
    } catch (err) {
      console.error('[Auth] Erro ao fazer signOut:', err);
      purgeClientSession();
      window.location.replace('/login?cleared=1');
    }
  }, [purgeClientSession]);

  // ------------------------------------------------------------------
  // UPDATE PROFILE
  // ------------------------------------------------------------------
  const updateProfile = useCallback(async (
    data: Partial<Pick<DbProfile, 'name' | 'avatar_url' | 'phone'>>
  ): Promise<AppError | null> => {
    if (!dbUser) return { code: 'not_authenticated', message: 'Utilizador nÃ£o autenticado.' };

    const { error } = await supabase
      .from('profiles')
      .update(data)
      .eq('user_id', dbUser.id);

    if (error) return { code: error.code, message: error.message };

    updateProfileStore(data);
    return null;
  }, [dbUser, updateProfileStore]);

  // ------------------------------------------------------------------
  // VALOR DO CONTEXTO
  // ------------------------------------------------------------------
  const clearAuthError = useCallback(() => setAuthError(null), []);
  const hasStaleUserData = Boolean(authUser && dbUser && dbUser.id !== authUser.id);
  const safeDbUser = hasStaleUserData ? null : dbUser;
  const safeProfile = hasStaleUserData ? null : profile;

  const value: AuthContextValue = {
    session,
    authUser,
    dbUser: safeDbUser,
    profile: safeProfile,
    role: safeDbUser && isValidUserRole((safeDbUser as { role?: unknown }).role)
      ? safeDbUser.role
      : UserRole.PASSENGER,
    loading: loading || hasStaleUserData,
    authError,
    clearAuthError,
    signIn,
    signInWithGoogle,
    signUp,
    signOut,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// =============================================================================
// HOOK
// =============================================================================

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('[useAuth] Deve ser usado dentro de <AuthProvider>');
  }
  return ctx;
};

// =============================================================================
// HELPER: traduzir erros de auth para portuguÃªs
// =============================================================================
function translateAuthError(msg: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials':           'Email ou password incorrectos.',
    'Email not confirmed':                 'Confirma o teu email antes de entrar.',
    'User already registered':             'Este email jÃ¡ tem uma conta.',
    'Password should be at least 6 characters': 'A password deve ter pelo menos 6 caracteres.',
    'signup_disabled':                     'Registo temporariamente desactivado.',
  };
  return map[msg] ?? `Erro de autenticaÃ§Ã£o: ${msg}`;
}

// ------------------------------------------------------------------
// UtilitÃ¡rio â€” detectar erros de permissÃ£o Supabase/PostgREST
// ------------------------------------------------------------------
function isPermissionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code    = (err as any).code;
  const message = String((err as any).message ?? '');
  return (
    code === '42501' ||                  // PostgreSQL permission denied
    code === 'PGRST301' ||               // PostgREST unauthorized
    message.toLowerCase().includes('permission denied') ||
    message.toLowerCase().includes('jwt')
  );
}

function isValidUserRole(role: unknown): role is UserRole {
  return (
    role === UserRole.PASSENGER ||
    role === UserRole.DRIVER ||
    role === UserRole.ADMIN
  );
}

function isSuspended(suspendedUntil: string | null | undefined): boolean {
  if (!suspendedUntil) return false;
  const ts = Date.parse(suspendedUntil);
  if (Number.isNaN(ts)) return false;
  return ts > Date.now();
}

function formatSuspendedMessage(suspendedUntil: string | null | undefined): string {
  if (!suspendedUntil) {
    return 'A tua conta estÃ¡ suspensa.';
  }
  const date = new Date(suspendedUntil);
  if (Number.isNaN(date.getTime())) {
    return 'A tua conta estÃ¡ suspensa.';
  }
  return `A tua conta estÃ¡ suspensa atÃ© ${date.toLocaleString('pt-AO')}.`;
}
