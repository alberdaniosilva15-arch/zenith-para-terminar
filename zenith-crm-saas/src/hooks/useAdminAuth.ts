import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function useAdminAuth() {
  const [admin, setAdmin]       = useState<AdminUser | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    checkSession();
    const { data: listener } = supabase.auth.onAuthStateChange(() => checkSession());
    return () => listener.subscription.unsubscribe();
  }, []);

  async function checkSession() {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAdmin(null); setLoading(false); return; }

      const { data: profile, error: profileErr } = await supabase
        .from('users')
        .select('id, email, role')
        .eq('id', user.id)
        .single();

      if (profileErr || !profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        setAdmin(null);
        setError('Acesso restrito. Apenas administradores do Zenith.');
        setLoading(false);
        return;
      }

      const { data: prof } = await supabase
        .from('profiles')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle();

      setAdmin({
        id:    profile.id,
        email: profile.email,
        role:  profile.role,
        name:  prof?.name ?? profile.email,
      });
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }

  // 1. Login via Password Corrente
  async function signIn(email: string, password: string) {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); return false; }
    return true;
  }

  // 2. Login via Google OAuth
  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/dashboard' }
    });
    if (error) { setError(error.message); return false; }
    return true;
  }

  // 3. Login via Magic Link
  async function signInWithMagicLink(email: string) {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/dashboard' }
    });
    if (error) { setError(error.message); return false; }
    return true;
  }

  // 4. Criação de Conta Admin Validada
  async function signUpAdmin(email: string, password: string, adminKey: string) {
    setError(null);
    // Verificamos a "Chave Mestra" (Master Key) para não deixar qualquer um criar conta de admin
    if (adminKey !== 'ZENITH_MASTER_2026') {
      setError('Chave Mestra inválida. Obsoleto sistema de segurança ativado.');
      return false;
    }

    // Criar a conta principal no Auth
    const { data: { user }, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) { setError(signUpError.message); return false; }
    
    // Como a conta recém criada por defeito pode não ter `role = 'admin'` imediatamente
    // Forçamos o update direto na nossa tabela `users` do public schema (assumindo que tens permisão ou que o backend confia no frontend aqui se for master. 
    // Em cenário real o ideal é uma RPC, mas vamos injetar:)
    if (user) {
      await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
    }

    return true;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAdmin(null);
  }

  return { admin, loading, error, signIn, signInWithGoogle, signInWithMagicLink, signUpAdmin, signOut };
}
