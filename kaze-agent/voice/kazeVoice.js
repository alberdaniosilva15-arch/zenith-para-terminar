const ELEVENLABS_VOICE_ID = 'TxGEqnHWrfWFTfGW9XjX'; // substitui pelo teu Voice ID
const ELEVENLABS_MODEL    = 'eleven_multilingual_v2';

async function speakElevenLabs(text, apiKey) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    // 429 = quota esgotada, 401 = auth → fallback automático
    if ([429, 401, 403].includes(res.status)) {
      console.warn(`[KAZE Voice] ElevenLabs ${res.status} → activando fallback Windows`);
      return speakWindowsFallback(text);
    }
    throw new Error(`ElevenLabs ${res.status}`);
  }

  const blob = await res.blob();
  const audio = new Audio(URL.createObjectURL(blob));
  audio.play();
  return { source: 'elevenlabs' };
}

function speakWindowsFallback(text) {
  if (!('speechSynthesis' in window)) return { source: 'none' };
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voices    = window.speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.lang.startsWith('pt'))
    || voices[0];
  utterance.lang   = 'pt-PT';
  utterance.rate   = 1.0;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
  return { source: 'windows_sapi' };
}

async function kazeSpeak(text, elevenLabsApiKey = null) {
  if (!text?.trim()) return;
  const clean = text
    .replace(/```[\s\S]*?```/g, 'código omitido')
    .replace(/[#*_`[\]]/g, '')
    .trim()
    .substring(0, 500);

  try {
    if (elevenLabsApiKey) return await speakElevenLabs(clean, elevenLabsApiKey);
    return speakWindowsFallback(clean);
  } catch (err) {
    console.warn('[KAZE Voice] Erro:', err.message);
    return speakWindowsFallback(clean);
  }
}

// Para vanilla JS:
window.kazeSpeak = kazeSpeak;
// Para módulos ES6: export { kazeSpeak };