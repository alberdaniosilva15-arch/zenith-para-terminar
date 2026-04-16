// src/hooks/useAdminAuth.ts
// FASE 0 — Autenticação Admin com validação server-side obrigatória
// NUNCA confiar no role local. Sempre validar via RPC is_admin_secure.
// v3.1: Todos os bypasses removidos — autenticação real exclusiva.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import type { User, Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";

// ─── Tipos ────────────────────────────────────────────────────
export type AdminAuthState =
  | "loading"        // a verificar
  | "authenticated"  // admin confirmado
  | "unauthorized"   // autenticado mas não é admin
  | "unauthenticated"; // sem sessão

interface UseAdminAuthReturn {
  state:        AdminAuthState;
  user:         User | null;
  isAdmin:      boolean;
  isLoading:    boolean;
  signIn:       (email: string, password: string) => Promise<{ error: string | null }>;
  signOut:      () => Promise<void>;
  promoteAdmin: (masterKey: string, userId: string) => Promise<{ error: string | null }>;
  error:        string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<boolean>;
  signUpAdmin: () => Promise<void>;
}

// ─── Constantes ───────────────────────────────────────────────
const ADMIN_GATE_URL = import.meta.env.VITE_ADMIN_GATE_URL as string;
const REVALIDATE_INTERVAL = 5 * 60 * 1000; // 5 min

// ─── Hook ─────────────────────────────────────────────────────
export function useAdminAuth(): UseAdminAuthReturn {
  // ✅ v3.1: Estado inicial é "loading" — sem bypass
  const [state, setState] = useState<AdminAuthState>("loading");
  const [user,  setUser]  = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const revalidateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Validação server-side do role admin via RPC ────────────
  const verifyAdminOnServer = useCallback(async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc("is_admin_secure");

      if (error) {
        console.error("[useAdminAuth] Erro na RPC is_admin_secure:", error.message);
        return false;
      }

      return data === true;
    } catch (err) {
      console.error("[useAdminAuth] Excepção na verificação admin:", err);
      return false;
    }
  }, []);

  // ── Forçar logout com feedback ──────────────────────────────
  const forceSignOut = useCallback(async (reason: string) => {
    console.warn(`[useAdminAuth] Logout forçado — motivo: ${reason}`);

    if (revalidateTimerRef.current) {
      clearInterval(revalidateTimerRef.current);
      revalidateTimerRef.current = null;
    }

    await supabase.auth.signOut();
    setUser(null);
    setState("unauthorized");
    setError("A tua conta não tem permissões de administrador.");
    navigate("/login?error=unauthorized");
  }, [navigate]);

  // ── Re-validação periódica ──────────────────────────────────
  const startPeriodicRevalidation = useCallback((_currentUser: User) => {
    if (revalidateTimerRef.current) {
      clearInterval(revalidateTimerRef.current);
    }

    revalidateTimerRef.current = setInterval(async () => {
      console.log("[useAdminAuth] Re-validando role admin...");
      const stillAdmin = await verifyAdminOnServer();

      if (!stillAdmin) {
        await forceSignOut("Role admin revogado pelo servidor");
      }
    }, REVALIDATE_INTERVAL);
  }, [verifyAdminOnServer, forceSignOut]);

  // ── Processar sessão: verificar se é admin no servidor ─────
  const processSession = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setUser(null);
      setState("unauthenticated");
      setError(null);

      if (revalidateTimerRef.current) {
        clearInterval(revalidateTimerRef.current);
        revalidateTimerRef.current = null;
      }
      return;
    }

    setState("loading");
    setUser(session.user);
    setError(null);

    // OBRIGATÓRIO: validar no servidor — nunca confiar no JWT local
    const isAdmin = await verifyAdminOnServer();

    if (!isAdmin) {
      await forceSignOut(`Utilizador ${session.user.email} não tem role admin`);
      return;
    }

    setState("authenticated");
    startPeriodicRevalidation(session.user);
  }, [verifyAdminOnServer, forceSignOut, startPeriodicRevalidation]);

  // ── Subscrição a mudanças de sessão ────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      processSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        processSession(session);
      }
    );

    return () => {
      subscription.unsubscribe();
      if (revalidateTimerRef.current) {
        clearInterval(revalidateTimerRef.current);
      }
    };
  }, [processSession]);

  // ── Sign In ─────────────────────────────────────────────────
  const signIn = useCallback(async (
    email:    string,
    password: string
  ): Promise<{ error: string | null }> => {
    setState("loading");
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setState("unauthenticated");
      const msg = error.message === 'Invalid login credentials'
        ? 'Email ou password incorrectos.'
        : error.message;
      setError(msg);
      return { error: msg };
    }

    // processSession será chamado pelo onAuthStateChange
    return { error: null };
  }, []);

  // ── Sign Out ────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    if (revalidateTimerRef.current) {
      clearInterval(revalidateTimerRef.current);
      revalidateTimerRef.current = null;
    }

    await supabase.auth.signOut();
    setUser(null);
    setState("unauthenticated");
    setError(null);
    navigate("/login");
  }, [navigate]);

  // ── Promover utilizador a Admin via Edge Function ───────────
  const promoteAdmin = useCallback(async (
    masterKey: string,
    userId:    string
  ): Promise<{ error: string | null }> => {
    if (!ADMIN_GATE_URL) {
      return { error: "VITE_ADMIN_GATE_URL não configurada no .env" };
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(ADMIN_GATE_URL, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": session ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ masterKey, userId }),
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.error ?? "Erro desconhecido" };
      }

      return { error: null };
    } catch (err) {
      return { error: `Falha de rede: ${String(err)}` };
    }
  }, []);

  // ── OAuth / Magic Link ─────────────────────────────────────
  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      return false;
    }
    return true;
  }, []);

  const signUpAdmin = useCallback(async () => {}, []);

  return {
    state,
    user,
    isAdmin:   state === "authenticated",
    isLoading: state === "loading",
    error,
    signIn,
    signOut,
    promoteAdmin,
    signInWithGoogle,
    signInWithMagicLink,
    signUpAdmin,
  };
}
