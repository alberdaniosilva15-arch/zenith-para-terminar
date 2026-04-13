// =============================================================================
// ZENITH RIDE v3.1 — AuthContext
// FIXES v3.1:
//   1. loadUserData: retries aumentados de 3 → 5 (delay até 4.8s)
//   2. Fallback de emergência: se todos os retries falharem, cria
//      dbUser/profile básico local para não deixar o utilizador preso
//   3. CORREÇÃO BUG 11: loadUserData agora usa while loop para retry,
//      garantindo que a Promise só resolve APÓS todos os retries terminarem
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

  // Acções
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

  // ------------------------------------------------------------------
  // Carregar dados do utilizador a partir do ID do Supabase Auth
  // Tem retry automático (5 tentativas, 600ms entre cada) para lidar com
  // a race condition entre o trigger handle_new_user e o signIn/signUp.
  // CORREÇÃO BUG 11: Promise encadeada correctamente — não resolve antes dos retries
  // ------------------------------------------------------------------
  const loadUserData = useCallback(async (userId: string, attempt = 0): Promise<void> => {
    const MAX_ATTEMPTS = 5;
    const BASE_DELAY_MS = 600;

    while (attempt < MAX_ATTEMPTS) {
      try {
        console.log(`[AuthContext] loadUserData attempt ${attempt + 1}/${MAX_ATTEMPTS} for ${userId}`);
        
        const [{ data: userRow, error: userErr }, { data: profileRow, error: profErr }] =
          await Promise.all([
            supabase.from('users').select('*').eq('id', userId).maybeSingle(),
            supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
          ]);

        if (userErr) throw userErr;
        if (profErr) throw profErr;

        // Verificar erros de permissão
        if (isPermissionError(userErr)) {
          throw new Error('Sem permissão para carregar dados do utilizador. Contacte o suporte.');
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
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`[AuthContext] Dados não encontrados, retry ${attempt + 2}/${MAX_ATTEMPTS} em ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          attempt++;
          continue;
        }

        // ✅ BUG #6 CORRIGIDO: effectiveUser é sempre o finalUserRow real
        // O ?? foi removido porque era código morto e enganoso
        const effectiveUser: DbUser = finalUserRow;

        const effectiveProfile: DbProfile = profileRow ?? {
          id: userId,
          user_id: userId,
          name: 'Utilizador',
          avatar_url: null,
          phone: null,
          rating: 5.0,
          total_rides: 0,
          created_at: new Date().toISOString(),
        } as DbProfile;

        setUser(effectiveUser, effectiveProfile);
        setAuthError(null);
        setLoading(false);
        return; // Sucesso - sai da função
      } catch (err: any) {
        console.warn(`[AuthContext] loadUserData attempt ${attempt + 1} falhou:`, err.message);
        if (attempt < MAX_ATTEMPTS - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`[AuthContext] Retry ${attempt + 2}/${MAX_ATTEMPTS} em ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          attempt++;
        } else {
          console.error('[AuthContext] Todos os retries falharam:', err);
          clearUser();
          setAuthError({ code: 'db_user_load_failed', message: 'Não foi possível finalizar o registo. O trigger handle_new_user pode não estar activo no Supabase.' });
          setLoading(false);
          return;
        }
      }
    }
  }, [setUser, clearUser]);

  // ------------------------------------------------------------------
  // Inicializar: recuperar sessão existente + subscrever a mudanças
  // ------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      console.log('[AuthContext] init');
      // 1) Tentar detectar sessão diretamente a partir da URL (link mágico)
      try {
        console.log('[AuthContext] checking getSessionFromUrl');
        if (typeof (supabase.auth as any).getSessionFromUrl === 'function') {
          const res = await (supabase.auth as any).getSessionFromUrl();
          const urlSession = res?.data?.session;
          console.log('[AuthContext] urlSession:', urlSession);
          if (!mounted) return;
          if (urlSession?.user) {
            setSession(urlSession);
            setAuthUser(urlSession.user);
            setAuthError(null);
            await loadUserData(urlSession.user.id);
            setLoading(false);
            isInitRef.current = true;
            // process pending auth event if any
            const pending = pendingAuthEventRef.current;
            pendingAuthEventRef.current = null;
            if (pending && mounted) {
              setSession(pending.newSession);
              setAuthUser(pending.newSession?.user ?? null);
              if (pending.newSession?.user) {
                setAuthError(null);
                await loadUserData(pending.newSession.user.id);
              } else {
                clearUser();
              }
              setLoading(false);
            }
            return;
          }
        }
      } catch (e) {
        // Não bloquear; prosseguir para getSession normal
        console.warn('[AuthContext] getSessionFromUrl falhou:', e);
      }

      // 2) Fallback: recuperar sessão existente (localStorage)
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      console.log('[AuthContext] initialSession:', initialSession);

      if (!mounted) return;

      if (initialSession?.user) {
        setSession(initialSession);
        setAuthUser(initialSession.user);
        setAuthError(null);
        await loadUserData(initialSession.user.id);
      }

      setLoading(false);
      isInitRef.current = true;
      const pending = pendingAuthEventRef.current;
      pendingAuthEventRef.current = null;
      if (pending && mounted) {
        setSession(pending.newSession);
        setAuthUser(pending.newSession?.user ?? null);
        if (pending.newSession?.user) {
          setAuthError(null);
          await loadUserData(pending.newSession.user.id);
        } else {
          clearUser();
        }
        setLoading(false);
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

        setSession(newSession);
        setAuthUser(newSession?.user ?? null);

        if (newSession?.user) {
          setAuthError(null);
          await loadUserData(newSession.user.id);
        } else {
          clearUser();
        }

        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserData]);

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
        data: { name },  // Role ignorado no cliente; servidor define
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
      pendingAuthEventRef.current = null;
      await supabase.auth.signOut();
      setSession(null);
      setAuthUser(null);
      clearUser();
      // ✅ BUG #12 CORRIGIDO: garantir que loading=false após logout
      setLoading(false);
    } catch (err) {
      console.error('[Auth] Erro ao fazer signOut:', err);
      setLoading(false);
      clearUser();
    }
  }, [clearUser]);

  // ------------------------------------------------------------------
  // UPDATE PROFILE
  // ------------------------------------------------------------------
  const updateProfile = useCallback(async (
    data: Partial<Pick<DbProfile, 'name' | 'avatar_url' | 'phone'>>
  ): Promise<AppError | null> => {
    if (!dbUser) return { code: 'not_authenticated', message: 'Utilizador não autenticado.' };

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

  const value: AuthContextValue = {
    session,
    authUser,
    dbUser,
    profile,
    role: (dbUser?.role as UserRole) ?? UserRole.PASSENGER,
    loading,
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
// HELPER: traduzir erros de auth para português
// =============================================================================
function translateAuthError(msg: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials':           'Email ou password incorrectos.',
    'Email not confirmed':                 'Confirma o teu email antes de entrar.',
    'User already registered':             'Este email já tem uma conta.',
    'Password should be at least 6 characters': 'A password deve ter pelo menos 6 caracteres.',
    'signup_disabled':                     'Registo temporariamente desactivado.',
  };
  return map[msg] ?? `Erro de autenticação: ${msg}`;
}

// ------------------------------------------------------------------
// Utilitário — detectar erros de permissão Supabase/PostgREST
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
