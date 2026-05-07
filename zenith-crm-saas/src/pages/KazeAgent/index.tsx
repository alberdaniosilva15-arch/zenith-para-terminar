import React, { useState, useRef, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import {
  Activity,
  Zap,
  ShieldCheck,
  Terminal,
  Database,
  Shield,
  Car,
  Users,
  TrendingUp,
  Cpu,
  Mic,
  Send,
} from "lucide-react";
import { useMetrics } from "../../hooks/useMetrics";
import { kazeSpeak } from "../../lib/kazeVoice";

const KazeAgent: React.FC = () => {
  const { metrics, loading: metricsLoading } = useMetrics();
  const [sentinelMsg, setSentinelMsg] = useState("");
  const [sentinelChat, setSentinelChat] = useState<
    Array<{
      id: string;
      role: "user" | "ai" | "system";
      text: string;
      tool_request?: { name: string; args: any };
      tool_result?: any;
      is_pending?: boolean;
    }>
  >([]);
  const [sentinelLoading, setSentinelLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");

  const [typingText, setTypingText] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const isListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const msgQueueRef = useRef<string[]>([]);
  const loadingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sentinelChat, interimText, sentinelLoading, typingText]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const typeMessage = (fullText: string, messageId: string) => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    let i = 0;
    const speed = 15;
    const type = () => {
      if (i < fullText.length) {
        i++;
        setSentinelChat((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, text: fullText.substring(0, i) } : m,
          ),
        );
        setTypingText(fullText.substring(0, i));
        typingTimeoutRef.current = setTimeout(type, speed);
      } else {
        setTypingText("");
      }
    };
    type();
  };

  // Boas-vindas com dados live
  useEffect(() => {
    if (!metricsLoading && sentinelChat.length === 0) {
      const hour = new Date().getHours();
      const greeting =
        hour < 12 ? "Bom dia" : hour < 19 ? "Boa tarde" : "Boa noite";
      setSentinelChat([
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `${greeting}, Comandante. Sistemas online — ${metrics.ridesActiveNow} corridas activas, ${metrics.driversOnline} motoristas disponíveis. Receita hoje: ${fmtKz(metrics.revenueToday)} Kz.`,
        },
      ]);
    }
  }, [metricsLoading]);

  // Queue processor
  const processQueue = async () => {
    if (loadingRef.current || msgQueueRef.current.length === 0) return;
    const next = msgQueueRef.current.shift()!;
    await askSentinel(next);
  };
  useEffect(() => {
    if (!sentinelLoading) processQueue();
  }, [sentinelLoading]);

  const isSpeakingRef = useRef(false);

  // ── STT ──
  const startListening = async () => {
    // Toggle OFF
    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      return;
    }

    // Verificar suporte
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSentinelChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: "Browser não suporta reconhecimento de voz. Use Chrome ou Edge.",
        },
      ]);
      return;
    }

    // Pedir permissão de microfone EXPLICITAMENTE antes de iniciar STT
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Parar o stream imediatamente — só precisávamos da permissão
      stream.getTracks().forEach((t) => t.stop());
    } catch (micErr: any) {
      console.error("[KAZE] Permissão de microfone negada:", micErr);
      setSentinelChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: "Permissão de microfone negada. Clique no ícone do cadeado na barra de endereço e permita o microfone.",
        },
      ]);
      return;
    }

    // Criar instância do reconhecimento
    const r = new SR();
    r.lang = "pt";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    recognitionRef.current = r;

    r.onstart = () => {
      isListeningRef.current = true;
      setIsListening(true);
      setInterimText("");
      console.log("[KAZE] 🎙️ Microfone ACTIVO");
    };

    r.onresult = (e: any) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += t;
        } else {
          interim += t;
        }
      }
      // Mostrar texto intermédio enquanto fala
      if (interim) setInterimText(interim);
      // Quando o browser detecta fim da frase
      if (finalText.trim()) {
        const text = finalText.trim();
        setInterimText(text);
        console.log("[KAZE] 🗣️ Ouviu:", text);
        // Limpar timer anterior e enviar
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          askSentinel(text);
        }, 600);
      }
    };

    r.onerror = (e: any) => {
      console.warn("[KAZE] STT error:", e.error);
      // Ignorar erros normais de silêncio
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Erro grave — parar
      if (e.error === "not-allowed") {
        isListeningRef.current = false;
        setIsListening(false);
        setSentinelChat((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            text: "Microfone bloqueado pelo browser. Verifique as permissões.",
          },
        ]);
      }
    };

    r.onend = () => {
      // Auto-restart se devia estar a escutar
      if (isListeningRef.current) {
        setTimeout(() => {
          if (isListeningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {
              // Se falhar a reiniciar, tentar criar nova instância
              try {
                const r2 = new SR();
                r2.lang = "pt";
                r2.interimResults = true;
                r2.continuous = false;
                r2.maxAlternatives = 1;
                r2.onstart = r.onstart;
                r2.onresult = r.onresult;
                r2.onerror = r.onerror;
                r2.onend = r.onend;
                recognitionRef.current = r2;
                r2.start();
              } catch {
                isListeningRef.current = false;
                setIsListening(false);
              }
            }
          }
        }, 150);
      } else {
        setIsListening(false);
      }
    };

    // Iniciar!
    try {
      r.start();
      console.log("[KAZE] SpeechRecognition.start() chamado com sucesso");
    } catch (e) {
      console.error("[KAZE] Falha ao iniciar STT:", e);
      isListeningRef.current = false;
      setIsListening(false);
    }
  };

  // ── Util: obter token válido ──
  // IMPORTANTE: NÃO usar refreshSession() — dispara onAuthStateChange que
  // causa re-render completo da app e apaga o chat. Usar apenas getSession().
  const getActiveToken = async (): Promise<string> => {
    const { data } = await supabase.auth.getSession();
    if (data?.session) return data.session.access_token;
    throw new Error("Sem sessão — faça login novamente");
  };

  // ── Core Agent ──
  const askSentinel = async (overrideMsg?: string) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const msg = overrideMsg || sentinelMsg;
    if (!msg.trim() || loadingRef.current) return;
    if (!overrideMsg) setSentinelMsg("");
    setInterimText("");
    const history = sentinelChat.slice(-10);
    setSentinelChat((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: msg },
    ]);
    setSentinelLoading(true);
    loadingRef.current = true;
    window.speechSynthesis.cancel();
    const wasListening = isListeningRef.current;
    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    }

    try {
      const token = await getActiveToken();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-ai-proxy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "sentinel_chat",
            message: msg,
            history,
            context: {
              ridesActive: metrics.ridesActiveNow,
              drivers: metrics.driversOnline,
              gmv: metrics.gmvToday,
            },
            request_id: crypto.randomUUID(),
          }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Status: ${res.status} - ${errText}`);
      }
      const data = await res.json();

      const onFinishedSpeaking = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        setInterimText("");
        if (wasListening) {
          // Delay de 2 segundos para não captar a própria voz do Kaze
          setTimeout(() => {
            startListening();
          }, 2000);
        }
      };

      // ── Handler: play_music (abrir YouTube) ──
      if (data.type === "tool_request" && data.tool_name === "play_music") {
        const query = data.tool_args?.query || "música";
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const msgId = crypto.randomUUID();
        setSentinelChat((prev) => [
          ...prev,
          {
            id: msgId,
            role: "ai",
            text: "",
            youtube_url: url,
            youtube_query: query,
          },
        ]);
        typeMessage(`🎵 YouTube: "${query}" — clique no link abaixo para abrir`, msgId);
        // Tentar abrir automaticamente (pode ser bloqueado)
        try { window.open(url, "_blank", "noopener,noreferrer"); } catch {}
        setIsSpeaking(true);
        await kazeSpeak(
          `A abrir YouTube com ${query}`,
          import.meta.env.VITE_ELEVENLABS_API_KEY,
        );
        onFinishedSpeaking();

        // Log no backend
        try {
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-ai-proxy`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                action: "execute_tool",
                request_id: crypto.randomUUID(),
                tool_name: "play_music",
                tool_args: data.tool_args,
              }),
            },
          );
        } catch {}
      }
      // ── Handler: tools que precisam de confirmação ──
      else if (data.type === "tool_request") {
        const msgId = crypto.randomUUID();
        setSentinelChat((prev) => [
          ...prev,
          {
            id: msgId,
            role: "ai",
            text: "",
            tool_request: { name: data.tool_name, args: data.tool_args },
            is_pending: true,
          },
        ]);
        typeMessage(
          "Acção operacional detectada. Autorização necessária.",
          msgId,
        );
        setIsSpeaking(true);
        await kazeSpeak(
          "Acção detectada. Aguardo autorização.",
          import.meta.env.VITE_ELEVENLABS_API_KEY,
        );
        onFinishedSpeaking();
      } else {
        // Limpar prefixo [TTS Error XXX] se existir
        const rawTxt = data.text || data.response || "Sem resposta.";
        const txt = rawTxt.replace(/^\[TTS Error \d+\]\s*/i, "").replace(/^\[TTS Catch Error:.*?\]\s*/i, "");
        const msgId = crypto.randomUUID();
        setSentinelChat((prev) => [
          ...prev,
          { id: msgId, role: "ai", text: "" },
        ]);
        typeMessage(txt, msgId);
        setIsSpeaking(true);
        // Chamar o motor de voz local (AntonioNeural)
        await kazeSpeak(txt, import.meta.env.VITE_ELEVENLABS_API_KEY);
        onFinishedSpeaking();
      }
    } catch (err: any) {
      setSentinelChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: "Falha: " + err.message,
        },
      ]);
    } finally {
      setSentinelLoading(false);
      loadingRef.current = false;
    }
  };

  const handleToolConfirm = async (id: string, ok: boolean, tr: any) => {
    setSentinelChat((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_pending: false } : m)),
    );
    if (!ok) {
      setSentinelChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: "Operação cancelada.",
        },
      ]);
      return;
    }
    setSentinelLoading(true);
    loadingRef.current = true;
    try {
      const token = await getActiveToken();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-ai-proxy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "execute_tool",
            request_id: crypto.randomUUID(),
            tool_name: tr.name,
            tool_args: tr.args,
          }),
        },
      );
      const data = await res.json();
      setSentinelChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: data.message || "Executado.",
          tool_result: data.result,
        },
      ]);
    } catch (err: any) {
      const errorMsg = err?.message || "Erro desconhecido";
      setSentinelChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `⚠️ Falha na operação: ${errorMsg}`,
        },
      ]);
      const recoveryPrompt = `A tool "${tr.name}" falhou com o erro: "${errorMsg}". Analisa a causa provável e sugere uma alternativa ao admin. Sê breve e directo.`;
      setTimeout(() => {
        msgQueueRef.current.push(recoveryPrompt);
        processQueue();
      }, 500);
    } finally {
      setSentinelLoading(false);
      loadingRef.current = false;
    }
  };

  const hud = [
    {
      icon: Car,
      label: "Corridas",
      value: metrics.ridesActiveNow,
      color: "#00e676",
    },
    {
      icon: Users,
      label: "Motoristas",
      value: metrics.driversOnline,
      color: "#ffffff",
    },
    {
      icon: TrendingUp,
      label: "Receita",
      value: fmtKz(metrics.revenueToday) + " Kz",
      color: "#d4af37",
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        background: "#080808",
      }}
    >
      {/* ═══════════ PAINEL LATERAL HUD ═══════════ */}
      <div
        style={{
          width: 260,
          minWidth: 260,
          display: "flex",
          flexDirection: "column",
          padding: "24px 20px",
          gap: 20,
          borderRight: "1px solid rgba(212,175,55,0.1)",
          background: "linear-gradient(180deg, #0c0c0c 0%, #080808 100%)",
        }}
      >
        {/* Titulo */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Shield size={22} color="#d4af37" />
            <span
              style={{
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: -1,
                color: "#fff",
                fontStyle: "italic",
              }}
            >
              KAZE
            </span>
          </div>
          <div
            style={{
              fontSize: 9,
              color: "rgba(212,175,55,0.5)",
              fontFamily: "var(--font-mono)",
              letterSpacing: 3,
              marginTop: 4,
            }}
          >
            SENTINEL AI · v2.0
          </div>
        </div>

        {/* Orbe */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "28px 0",
          }}
        >
          <div className="kaze-orb-container">
            <div className="kaze-bracket-tr" />
            <div className="kaze-bracket-bl" />
            <div
              onClick={startListening}
              className={`kaze-orb${isListening ? " listening" : ""}`}
              style={{
                cursor: "pointer",
                width: 140,
                height: 140,
                transition: "all 0.5s ease",
              }}
            >
              <Cpu
                size={36}
                style={{
                  color: "rgba(255,255,255,0.7)",
                  position: "relative",
                  zIndex: 2,
                }}
              />
            </div>
          </div>
        </div>

        {/* Status */}
        <div style={{ textAlign: "center" }}>
          <div
            className={
              isListening
                ? "kaze-status-listening"
                : sentinelLoading
                  ? "kaze-status-processing"
                  : typingText
                    ? "kaze-status-speaking"
                    : "kaze-status-idle"
            }
            style={{
              display: "inline-block",
              padding: "5px 16px",
              borderRadius: 20,
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              letterSpacing: 2,
              textTransform: "uppercase" as const,
              fontWeight: 700,
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            {isListening
              ? "● A ESCUTAR"
              : sentinelLoading
                ? "◌ A PROCESSAR"
                : typingText
                  ? "◈ A FALAR"
                  : "◉ OPERACIONAL"}
          </div>
        </div>

        {/* Waveform — visível quando o Kaze está a falar */}
        {isSpeaking && (
          <div
            className="kaze-waveform"
            style={{ justifyContent: "center", marginTop: 12 }}
          >
            {[...Array(5)].map((_, i) => (
              <div key={i} className="kaze-waveform-bar" />
            ))}
          </div>
        )}

        {/* Divider */}
        <div
          style={{
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(212,175,55,0.2), transparent)",
          }}
        />

        {/* HUD Metrics */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}
        >
          {hud.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderRadius: 14,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <m.icon size={13} style={{ color: "rgba(255,255,255,0.3)" }} />
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: "var(--font-mono)",
                    textTransform: "uppercase" as const,
                    letterSpacing: 1,
                  }}
                >
                  {m.label}
                </span>
              </div>
              <span style={{ fontSize: 18, fontWeight: 800, color: m.color }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>

        {/* Version */}
        <div
          style={{
            fontSize: 8,
            color: "rgba(255,255,255,0.1)",
            fontFamily: "var(--font-mono)",
            textAlign: "center",
            letterSpacing: 2,
          }}
        >
          ZENITH · KAZE · {new Date().getFullYear()}
        </div>
      </div>

      {/* ═══════════ ÁREA DE CHAT ═══════════ */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* Chat Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "28px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
          className="scrollbar-hide"
        >
          {sentinelChat.length === 0 && !metricsLoading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                opacity: 0.15,
              }}
            >
              <ShieldCheck size={80} color="#d4af37" />
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  color: "#d4af37",
                  marginTop: 16,
                  letterSpacing: 3,
                  textTransform: "uppercase" as const,
                }}
              >
                SISTEMAS PRONTOS
              </div>
            </div>
          )}

          {sentinelChat.map((m) => (
            <div
              key={m.id}
              style={{
                maxWidth: "75%",
                alignSelf:
                  m.role === "user"
                    ? "flex-end"
                    : m.role === "system"
                      ? "center"
                      : "flex-start",
                padding: m.role === "system" ? "10px 20px" : "16px 20px",
                borderRadius:
                  m.role === "user"
                    ? "20px 20px 4px 20px"
                    : m.role === "ai"
                      ? "20px 20px 20px 4px"
                      : 12,
                fontSize: m.role === "system" ? 11 : 14,
                lineHeight: 1.6,
                ...(m.role === "user"
                  ? {
                      background:
                        "linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))",
                      border: "1px solid rgba(212,175,55,0.2)",
                      color: "#fff",
                    }
                  : m.role === "system"
                    ? {
                        background: "transparent",
                        border: "1px solid rgba(212,175,55,0.1)",
                        color: "rgba(212,175,55,0.6)",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: 1,
                        textTransform: "uppercase" as const,
                        width: "100%",
                        textAlign: "center" as const,
                      }
                    : {
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.85)",
                      }),
              }}
            >
              {m.role === "ai" && (
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 900,
                    color: "#d4af37",
                    letterSpacing: 3,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    textTransform: "uppercase" as const,
                  }}
                >
                  <Zap size={11} /> KAZE
                </div>
              )}
              {m.role === "user" && (
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 900,
                    color: "rgba(212,175,55,0.4)",
                    letterSpacing: 3,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "flex-end",
                    textTransform: "uppercase" as const,
                  }}
                >
                  <Terminal size={11} /> ADMIN
                </div>
              )}
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>

              {(m as any).youtube_url && (
                <a
                  href={(m as any).youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    marginTop: 10,
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "rgba(255,0,0,0.15)",
                    border: "1px solid rgba(255,0,0,0.3)",
                    color: "#ff4444",
                    fontSize: 12,
                    fontWeight: 700,
                    textDecoration: "none",
                    cursor: "pointer",
                  }}
                >
                  ▶ Abrir YouTube: {(m as any).youtube_query}
                </a>
              )}
              {m.tool_result && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 14,
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.6)",
                    border: "1px solid rgba(0,230,118,0.15)",
                    fontSize: 11,
                    color: "#00e676",
                    fontFamily: "var(--font-mono)",
                    overflowX: "auto",
                  }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: 2,
                      color: "rgba(0,230,118,0.4)",
                      marginBottom: 6,
                      textTransform: "uppercase" as const,
                    }}
                  >
                    <Database
                      size={9}
                      style={{
                        display: "inline",
                        verticalAlign: "middle",
                        marginRight: 4,
                      }}
                    />
                    OUTPUT
                  </div>
                  {JSON.stringify(m.tool_result, null, 2)}
                </div>
              )}

              {m.is_pending && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 16,
                    borderRadius: 12,
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(212,175,55,0.25)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 900,
                      color: "#d4af37",
                      letterSpacing: 2,
                      marginBottom: 10,
                      textTransform: "uppercase" as const,
                    }}
                  >
                    <Shield
                      size={12}
                      style={{
                        display: "inline",
                        verticalAlign: "middle",
                        marginRight: 6,
                      }}
                    />
                    AUTORIZAÇÃO
                  </div>
                  <pre
                    style={{
                      fontSize: 10,
                      color: "rgba(212,175,55,0.6)",
                      fontFamily: "var(--font-mono)",
                      background: "rgba(0,0,0,0.5)",
                      padding: 10,
                      borderRadius: 8,
                      overflow: "auto",
                      marginBottom: 12,
                      border: "1px solid rgba(212,175,55,0.1)",
                    }}
                  >
                    {JSON.stringify(m.tool_request?.args, null, 2)}
                  </pre>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() =>
                        handleToolConfirm(m.id, true, m.tool_request)
                      }
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 8,
                        border: "none",
                        background: "#d4af37",
                        color: "#000",
                        fontWeight: 900,
                        fontSize: 10,
                        letterSpacing: 2,
                        cursor: "pointer",
                        textTransform: "uppercase" as const,
                      }}
                    >
                      AUTORIZAR
                    </button>
                    <button
                      onClick={() =>
                        handleToolConfirm(m.id, false, m.tool_request)
                      }
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 8,
                        border: "1px solid rgba(255,68,68,0.4)",
                        background: "transparent",
                        color: "#ff4444",
                        fontWeight: 900,
                        fontSize: 10,
                        letterSpacing: 2,
                        cursor: "pointer",
                        textTransform: "uppercase" as const,
                      }}
                    >
                      REJEITAR
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {sentinelLoading && (
            <div
              style={{
                alignSelf: "flex-start",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 0",
                color: "#d4af37",
              }}
            >
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )}

          {interimText && (
            <div
              style={{
                alignSelf: "flex-end",
                padding: "14px 18px",
                borderRadius: "18px 18px 4px 18px",
                background: "rgba(212,175,55,0.08)",
                border: "1px solid rgba(212,175,55,0.15)",
                color: "rgba(212,175,55,0.7)",
                fontSize: 14,
                fontStyle: "italic",
              }}
            >
              {interimText}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ═══ Input Bar ═══ */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid rgba(212,175,55,0.08)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "rgba(0,0,0,0.3)",
          }}
        >
          <button
            onClick={startListening}
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              border: isListening
                ? "1px solid #ff4444"
                : "1px solid rgba(255,255,255,0.08)",
              background: isListening
                ? "rgba(255,68,68,0.1)"
                : "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.3s",
            }}
          >
            <Mic
              size={20}
              style={{ color: isListening ? "#ff4444" : "#d4af37" }}
            />
          </button>

          <input
            type="text"
            value={sentinelMsg}
            onChange={(e) => setSentinelMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askSentinel()}
            placeholder={
              isListening
                ? "Fale agora..."
                : "Escreva um comando ou pergunta..."
            }
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 14,
              padding: "14px 18px",
              fontSize: 14,
              color: "#fff",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />

          <button
            onClick={() => askSentinel()}
            disabled={!sentinelMsg.trim() || sentinelLoading}
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              border: "none",
              background: sentinelMsg.trim()
                ? "linear-gradient(135deg, #d4af37, #a88a2a)"
                : "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: sentinelMsg.trim() ? "pointer" : "not-allowed",
              opacity: sentinelMsg.trim() && !sentinelLoading ? 1 : 0.3,
              transition: "all 0.3s",
            }}
          >
            <Send
              size={18}
              style={{ color: sentinelMsg.trim() ? "#000" : "#666" }}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

function fmtKz(v: number): string {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
  if (v >= 1000) return (v / 1000).toFixed(0) + "k";
  return String(v);
}

export default KazeAgent;
