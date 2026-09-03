// =============================================================================
// ZENITH RIDE — kazeAudioTranscribe.ts
// Utilitário de transcrição de áudio
// =============================================================================

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

export async function transcribeAudioFallback(_blob: Blob): Promise<string> {
  return '';
}

export const transcribeAudioWithGemini = transcribeAudioFallback;
