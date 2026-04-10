import { supabase } from './supabase';

export async function askGemini(prompt: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: {
      action: 'kaze_chat',
      message: prompt,
      history: [{ role: 'user', content: prompt }]
    },
  });
  if (error) throw error;
  return data?.text ?? '';
}
