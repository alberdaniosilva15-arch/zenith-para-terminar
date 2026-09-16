// ──────────────────────────────────────────────────────────────────────────────
// Voz do Kaze via Gemini TTS (acção `kaze_tts` do gemini-proxy)
// ──────────────────────────────────────────────────────────────────────────────
// Porque existe este ficheiro em vez de usar o `callProxy` do geminiService:
// o geminiService importa `kazeSpeak` deste lado (kazeVoice), e o kazeVoice
// precisa de sintetizar fala. Importar o geminiService aqui criaria um ciclo
// kazeVoice → geminiService → kazeVoice. Funcionaria, mas fica frágil e difícil
// de seguir. Este módulo fala com o proxy directamente e o ciclo não existe.
//
// A chave do Gemini continua a nunca sair do servidor: o browser só pede o
// áudio já sintetizado.
// ──────────────────────────────────────────────────────────────────────────────

import { supabase, edgeFunctionUrl } from './supabase';

/** PCM cru devolvido pelo servidor: 16 bits, mono, 24 kHz. */
export interface KazeTtsResposta {
  /** Áudio em base64 (`audio/l16`). */
  audio: string;
  /** 24000 — o servidor é explícito para o cliente não ter de adivinhar. */
  sample_rate: number;
  mime?: string;
  voice?: string;
  model?: string;
}

/**
 * Sintetiza `texto` com a voz do Gemini.
 *
 * Lança se não houver sessão, se o servidor recusar ou se vier áudio vazio —
 * quem chama decide o que fazer. NÃO há fallback para a `speechSynthesis` do
 * dispositivo: era exactamente essa voz (a do telemóvel) que se queria deixar
 * de usar. Falhar em silêncio é melhor do que falar com a voz errada.
 *
 * O timeout é de 25 s porque a síntese medida contra a API real leva ~5,5 s
 * para uma frase de 85 caracteres, e uma frase longa leva mais.
 */
export async function kazeTts(texto: string, voice?: string): Promise<KazeTtsResposta> {
  const limpo = texto?.trim();
  if (!limpo) throw new Error('Texto em falta para a voz do Kaze.');

  const { data: sessao, error: erroSessao } = await supabase.auth.getSession();
  if (erroSessao || !sessao?.session) {
    throw new Error('Sessão expirada — entra de novo para ouvires o Kaze.');
  }

  const controlador = new AbortController();
  const cronometro = setTimeout(() => controlador.abort(), 25000);

  try {
    const res = await fetch(edgeFunctionUrl('gemini-proxy'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessao.session.access_token}`,
      },
      body: JSON.stringify({ action: 'kaze_tts', text: limpo, voice }),
      signal: controlador.signal,
    });

    if (!res.ok) {
      // O servidor responde com uma mensagem em português já pensada para o
      // utilizador; aproveitá-la dá erros mais úteis do que "HTTP 502".
      let mensagem = `Erro HTTP ${res.status}`;
      try {
        const corpo = await res.json();
        mensagem = corpo?.message ?? corpo?.error ?? mensagem;
      } catch { /* resposta sem JSON — fica o código */ }
      throw new Error(mensagem);
    }

    const dados = (await res.json()) as KazeTtsResposta;
    if (!dados?.audio) throw new Error('O servidor não devolveu áudio.');
    return dados;
  } finally {
    clearTimeout(cronometro);
  }
}
