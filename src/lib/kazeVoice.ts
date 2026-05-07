const ELEVENLABS_VOICE_ID = 'TxGEqnHWrfWFTfGW9XjX';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const LOCAL_TTS_URL = 'http://127.0.0.1:3848/tts';

async function speakLocalTTS(text: string) {
  const res = await fetch(LOCAL_TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(`Local TTS ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  
  audio.onended = () => {
    URL.revokeObjectURL(url);
  };
  
  audio.play();
  return { source: 'local_python' as const };
}

async function speakElevenLabs(text: string, apiKey: string) {
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
    if ([429, 401, 403].includes(res.status)) {
      console.warn(`[KAZE Voice] ElevenLabs ${res.status} → fallback`);
      return speakWindowsFallback(text);
    }
    throw new Error(`ElevenLabs ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  
  audio.onended = () => {
    URL.revokeObjectURL(url);
  };
  
  audio.play();
  return { source: 'elevenlabs' as const };
}

function speakWindowsFallback(text: string) {
  if (!('speechSynthesis' in window)) return { source: 'none' as const };
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.lang.startsWith('pt'))
    || voices[0] || null;
  utterance.lang = 'pt-PT';
  utterance.rate = 1.0;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
  return { source: 'windows_sapi' as const };
}

export async function kazeSpeak(text: string, elevenLabsApiKey: string | null = null) {
  if (!text?.trim()) return;
  const clean = text
    .replace(/```[\s\S]*?```/g, 'código omitido')
    .replace(/[#*_`[\]]/g, '')
    .trim()
    .substring(0, 500);

  try {
    try {
      // 1. Tentar servidor local (Prioridade - AntonioNeural Masculino)
      return await speakLocalTTS(clean);
    } catch (localErr) {
      console.warn('[KAZE Voice] Servidor local falhou:', localErr);
      
      // 2. Tentar ElevenLabs se houver chave
      if (elevenLabsApiKey) {
        return await speakElevenLabs(clean, elevenLabsApiKey);
      }
      
      throw new Error('Fallback para Windows SAPI');
    }
  } catch (err: any) {
    console.warn('[KAZE Voice] Fallback activado:', err.message);
    // 3. Fallback final offline do Windows
    return speakWindowsFallback(clean);
  }
}
