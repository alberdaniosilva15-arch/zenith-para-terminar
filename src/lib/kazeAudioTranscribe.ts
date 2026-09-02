// =============================================================================
// ZENITH RIDE — kazeAudioTranscribe.ts
// Transcrição de Áudio de Alta Fidelidade com Gemini 2.5 Flash
// Permite que o microfone funcione em QUALQUER navegador (desktop e mobile)
// =============================================================================

const FRONTEND_GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export async function transcribeAudioWithGemini(blob: Blob): Promise<string> {
  if (!FRONTEND_GEMINI_KEY) {
    throw new Error('Chave de IA para transcrição de áudio não configurada.');
  }

  // 1. Converter áudio Blob para Base64
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const base64Audio = btoa(binary);

  // 2. Chamar Gemini 2.5 Flash para transcrição ultra-rápida em português de Angola
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${FRONTEND_GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Transcreve o áudio em português com máxima precisão. Retorna APENAS as palavras faladas pelo utilizador, sem aspas e sem comentários adicionais.',
              },
              {
                inline_data: {
                  mime_type: blob.type || 'audio/webm',
                  data: base64Audio,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Erro na transcrição de áudio (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return transcript;
}
