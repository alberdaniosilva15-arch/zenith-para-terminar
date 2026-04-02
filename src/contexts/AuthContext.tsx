// =============================================================================
// MOTOGO AI v2.0 — AuthContext
// Substitui completamente o sistema mock (user_123)
// Gere sessão, user, profile e role em toda a aplicação
// =============================================================================

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { DbUser, DbProfile, AppError } from '../types';
import { UserRole } from '../types';

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

  // Acções
  signIn:      (email: string, password: string) => Promise<AppError | null>;
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
  const [dbUser,   setDbUser]   = useState<DbUser | null>(null);
  const [profile,  setProfile]  = useState<DbProfile | null>(null);
  const [loading,  setLoading]  = useState(true);

  // ------------------------------------------------------------------
  // Carregar dados do utilizador a partir do ID do Supabase Auth
  // Tem retry automático (3 tentativas, 600ms entre cada) para lidar com
  // a race condition entre o trigger handle_new_user e o signIn/signUp.
  // ------------------------------------------------------------------
  const loadUserData = useCallback(async (userId: string, attempt = 0) => {
    try {
      const [{ data: userRow, error: userErr }, { data: profileRow, error: profErr }] =
        await Promise.all([
          supabase.from('users').select('*').eq('id', userId).single(),
          supabase.from('profiles').select('*').eq('user_id', userId).single(),
        ]);

      if (userErr)  throw userErr;
      if (profErr)  throw profErr;

      setDbUser(userRow as DbUser);
      setProfile(profileRow as DbProfile);
    } catch (err) {
      if (attempt < 3) {
        // Retry após delay — o trigger handle_new_user pode ainda não ter criado a linha
        setTimeout(() => loadUserData(userId, attempt + 1), 600);
      } else {
        console.error('[AuthContext] Erro ao carregar dados do utilizador após retries:', err);
        setDbUser(null);
        setProfile(null);
      }
    }
  }, []);

  // ------------------------------------------------------------------
  // Inicializar: recuperar sessão existente + subscrever a mudanças
  // ------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession();

      if (!mounted) return;

      if (initialSession?.user) {
        setSession(initialSession);
        setAuthUser(initialSession.user);
        await loadUserData(initialSession.user.id);
      }

      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        setSession(newSession);
        setAuthUser(newSession?.user ?? null);

        if (newSession?.user) {
          await loadUserData(newSession.user.id);
        } else {
          setDbUser(null);
          setProfile(null);
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
        data: { name, role },  // passado para handle_new_user() trigger
      },
    });

    if (signUpError) {
      return { code: signUpError.message, message: translateAuthError(signUpError.message) };
    }

    // 2. Actualizar role na tabela users (o trigger cria com 'passenger' por default)
    if (data.user && role !== UserRole.PASSENGER) {
      const { error: roleError } = await supabase
        .from('users')
        .update({ role })
        .eq('id', data.user.id);

      if (roleError) {
        console.error('[AuthContext] Erro ao definir role:', roleError);
      }
    }

    return null;
  }, []);

  // ------------------------------------------------------------------
  // SIGN OUT
  // ------------------------------------------------------------------
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAuthUser(null);
    setDbUser(null);
    setProfile(null);
  }, []);

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

    setProfile(prev => prev ? { ...prev, ...data } : null);
    return null;
  }, [dbUser]);

  // ------------------------------------------------------------------
  // VALOR DO CONTEXTO
  // ------------------------------------------------------------------
  const value: AuthContextValue = {
    session,
    authUser,
    dbUser,
    profile,
    role: (dbUser?.role as UserRole) ?? UserRole.PASSENGER,
    loading,
    signIn,
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
