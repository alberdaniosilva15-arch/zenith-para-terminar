// src/hooks/useAdminAuth.ts
// FASE 0 — Autenticação Admin com validação server-side obrigatória
// NUNCA confiar no role local. Sempre validar via RPC.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase"; // ajustado para o caminho do projecto
import type { User, Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";

// ─── Tipos ────────────────────────────────────────────────────
export type AdminAuthState =
  | "loading"      // a verificar
  | "authenticated" // admin confirmado
  | "unauthorized" // autenticado mas não é admin
  | "unauthenticated"; // sem sessão

interface UseAdminAuthReturn {
  state:        AdminAuthState;
  user:         User | null;
  isAdmin:      boolean;
  isLoading:    boolean;
  signIn:       (email: string, password: string) => Promise<{ error: string | null }>;
  signOut:      () => Promise<void>;
  promoteAdmin: (masterKey: string, userId: string) => Promise<{ error: string | null }>;
}

// ─── Constantes ───────────────────────────────────────────────
// URL da Edge Function — usa variável de ambiente, nunca hardcode
const ADMIN_GATE_URL = import.meta.env.VITE_ADMIN_GATE_URL as string;
// Intervalo de re-validação do role no servidor (ms) — a cada 5 min
const REVALIDATE_INTERVAL = 5 * 60 * 1000;

// ─── Hook ─────────────────────────────────────────────────────
export function useAdminAuth(): UseAdminAuthReturn {
  const [state, setState] = useState<AdminAuthState>("loading");
  const [user,  setUser]  = useState<User | null>(null);
  const navigate = useNavigate();

  // Ref para o intervalo de re-validação
  const revalidateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Validação server-side do role admin ────────────────────
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

    // Parar re-validação periódica
    if (revalidateTimerRef.current) {
      clearInterval(revalidateTimerRef.current);
      revalidateTimerRef.current = null;
    }

    await supabase.auth.signOut();
    setUser(null);
    setState("unauthorized");
    navigate("/login?error=unauthorized");
  }, [navigate]);

  // ── Re-validação periódica (verifica se role foi revogado) ──
  const startPeriodicRevalidation = useCallback((currentUser: User) => {
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

      if (revalidateTimerRef.current) {
        clearInterval(revalidateTimerRef.current);
        revalidateTimerRef.current = null;
      }
      return;
    }

    setState("loading");
    setUser(session.user);

    // OBRIGATÓRIO: validar no servidor — nunca confiar no JWT local
    const isAdmin = await verifyAdminOnServer();

    if (!isAdmin) {
      // Utilizador autenticado mas NÃO é admin → logout imediato
      await forceSignOut(`Utilizador ${session.user.email} não tem role admin`);
      return;
    }

    setState("authenticated");
    startPeriodicRevalidation(session.user);
  }, [verifyAdminOnServer, forceSignOut, startPeriodicRevalidation]);

  // ── Subscrição a mudanças de sessão ────────────────────────
  useEffect(() => {
    // Verificar sessão actual ao montar
    supabase.auth.getSession().then(({ data: { session } }) => {
      processSession(session);
    });

    // Ouvir mudanças futuras (login, logout, token refresh)
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

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setState("unauthenticated");
      return { error: error.message };
    }

    // processSession é chamado automaticamente pelo onAuthStateChange
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

  return {
    state,
    user,
    isAdmin:   state === "authenticated",
    isLoading: state === "loading",
    signIn,
    signOut,
    promoteAdmin,
  };
}
