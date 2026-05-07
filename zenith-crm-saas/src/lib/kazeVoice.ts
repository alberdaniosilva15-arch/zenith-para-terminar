// ═══════════════════════════════════════════════════════════
// KAZE VOICE — Motor de voz do Sentinel AI
// Prioridade: Edge TTS (local) → Google Cloud TTS (backend) → Windows SAPI
// ═══════════════════════════════════════════════════════════

const EDGE_TTS_URL = "http://127.0.0.1:3848/tts";

// 1) Edge TTS (servidor local Python — gratuito, voz neural Microsoft)
async function speakEdgeTTS(text: string): Promise<{ source: "edge_tts" }> {
  const res = await fetch(EDGE_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: "pt-BR-AntonioNeural" }),
  });

  if (!res.ok) throw new Error(`Edge TTS ${res.status}`);

  const blob = await res.blob();
  const audio = new Audio(URL.createObjectURL(blob));
  return new Promise<{ source: "edge_tts" }>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      resolve({ source: "edge_tts" });
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      reject(new Error("Audio playback failed"));
    };
    audio.play().catch(reject);
  });
}

// 2) Windows SAPI Fallback (voz masculina local)
function speakWindowsFallback(text: string): Promise<{ source: "windows_sapi" | "none" }> {
  if (!("speechSynthesis" in window)) return Promise.resolve({ source: "none" as const });
  window.speechSynthesis.cancel();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    const maleKeywords = ["daniel", "david", "mark", "jorge", "pablo", "antonio", "male"];
    const isMale = (v: SpeechSynthesisVoice) =>
      maleKeywords.some((k) => v.name.toLowerCase().includes(k));

    const ptMale = voices.find((v) => v.lang.startsWith("pt") && isMale(v));
    const ptAny = voices.find((v) => v.lang.startsWith("pt"));
    const enMale = voices.find((v) => v.lang.startsWith("en") && isMale(v) && v.localService);
    const anyMale = voices.find((v) => isMale(v));

    utterance.voice = ptMale || ptAny || enMale || anyMale || voices[0] || null;
    utterance.lang = "pt-PT";
    utterance.rate = 1.05;
    utterance.pitch = 0.85;
    utterance.volume = 1.0;
    utterance.onend = () => resolve({ source: "windows_sapi" as const });
    utterance.onerror = () => resolve({ source: "windows_sapi" as const });

    window.speechSynthesis.speak(utterance);
  });
}

// ═══ Função Principal ═══
export async function kazeSpeak(
  text: string,
  _elevenLabsApiKey: string | null = null,
) {
  if (!text?.trim()) return;
  const clean = text
    .replace(/```[\s\S]*?```/g, "código omitido")
    .replace(/[#*_`[\]]/g, "")
    .replace(/\[TTS Error \d+\]\s*/gi, "")
    .trim()
    .substring(0, 500);

  // 1) Tentar Edge TTS (servidor local)
  try {
    const result = await speakEdgeTTS(clean);
    console.log("[KAZE Voice] ✅ Edge TTS (AntonioNeural)");
    return result;
  } catch (e: any) {
    console.warn("[KAZE Voice] Edge TTS indisponível:", e.message);
  }

  // 2) Fallback: Windows SAPI (voz masculina local)
  console.log("[KAZE Voice] Usando Windows SAPI fallback");
  return speakWindowsFallback(clean);
}
