// =============================================================================
// ZENITH RIDE — Edge Function: sentinel-vision
// IA de Validacao de Documentos (Motoristas)
// Utiliza Gemini 2.0 Flash Vision para validar BIs e dados auto.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1';
import { applyCors, corsForbidden, resolveCorsHeaders } from '../_shared/cors.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

function respond(message: string, status: number, corsHeaders: Headers | null, data?: any) {
  return applyCors(
    new Response(JSON.stringify(data ? { ...data, message } : { error: true, message }), {
      status, headers: { 'Content-Type': 'application/json' },
    }), corsHeaders
  );
}

export default Deno.serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req, CORS_OPTIONS);
  if (req.headers.get('Origin') && !corsHeaders) return corsForbidden();
  if (req.method === 'OPTIONS') return applyCors(new Response(null, { status: 204 }), corsHeaders);
  if (req.method !== 'POST') return respond('Método não suportado.', 405, corsHeaders);

  try {
    // 1. Validação Admin JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return respond('Token em falta.', 401, corsHeaders);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return respond('Sessão inválida.', 401, corsHeaders);

    const { data: dbUser } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    if (!dbUser || dbUser.role !== 'admin') return respond('Acesso negado.', 403, corsHeaders);

    const { documentId } = await req.json();
    if (!documentId) return respond('documentId é obrigatório.', 400, corsHeaders);

    // 2. Buscar Dados do Documento
    const { data: doc } = await admin
      .from('driver_documents')
      .select('*, profiles(name, phone)')
      .eq('id', documentId)
      .maybeSingle();

    if (!doc) return respond('Documento não encontrado.', 404, corsHeaders);
    if (doc.status !== 'pending') return respond('Documento não está pendente.', 400, corsHeaders);

    let base64Image = null;
    let mimeType = 'image/jpeg';

    if (doc.bi_storage_path) {
      const { data, error } = await admin.storage.from('driver_docs').download(doc.bi_storage_path);
      if (!error && data) {
        mimeType = data.type || 'image/jpeg';
        
        // UPLOAD DEFENSE: Limite 5MB e Mime-Type
        if (data.size > 5 * 1024 * 1024) {
          await updateDocument(documentId, 'rejected', 'A imagem excede o limite máximo de 5MB. Por favor, submeta uma imagem mais leve.', user.id);
          return respond('Ficheiro gigante detectado', 200, corsHeaders, { status: 'rejected' });
        }
        if (!mimeType.startsWith('image/')) {
          await updateDocument(documentId, 'rejected', 'Formato de ficheiro inválido. Apenas imagens são permitidas.', user.id);
          return respond('Ficheiro invalido detectado', 200, corsHeaders, { status: 'rejected' });
        }

        const arrayBuffer = await data.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        // Base64 encoding sem usar Buffer
        let binary = '';
        for (let i = 0; i < uint8Array.byteLength; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        base64Image = btoa(binary);
      }
    }

    // NÍVEL 2: Validação de Regras (Regex, Idade, Info em Falta)
    if (!doc.car_plate?.match(/^[A-Z]{2}-\d{2}-\d{2}-[A-Z]{2}$/)) {
      await updateDocument(documentId, 'rejected', 'A matrícula introduzida não segue o formato válido de Angola (ex: LD-01-02-AB).', user.id);
      return respond('Recusado por Regras', 200, corsHeaders, { status: 'rejected' });
    }
    
    if (!base64Image) {
        await updateDocument(documentId, 'rejected', 'Não foi detectada a fotografia do Bilhete de Identidade ou Passaporte.', user.id);
        return respond('Recusado por Regras', 200, corsHeaders, { status: 'rejected' });
    }

    // NÍVEL 1: IA Gemini Vision
    const prompt = `Atua como Sentinel, IA de Admissão da Zenith Ride.
Tens de validar a autenticidade deste motorista.
DADOS DO MOTORISTA:
- Nome: ${doc.profiles?.[0]?.name}
- Telefone: ${doc.profiles?.[0]?.phone}
- Carro: ${doc.car_brand} ${doc.car_model} (${doc.car_color})
- Matrícula: ${doc.car_plate}
- Possui Ar Condicionado: ${doc.has_ac ? 'Sim' : 'Não'}

TAREFA:
Analisa a imagem anexada (que deve ser um documento de identificação: BI Angolano, Carta de Condução ou Passaporte).
1. Se a imagem NÃO for um documento válido (ex: selfie, paisagem, muito escura, ilegível), deves REJEITAR.
2. Se a imagem parecer um documento falsificado ou não corresponder ao nome, deves REJEITAR.
3. Se o documento for válido e legível, APROVAR.
4. Se estiveres com dúvidas (reflexo forte, documento cortado), pede "PENDING_HUMAN".

RETORNA APENAS UM JSON VÁLIDO NO FORMATO:
{
  "action": "approve" | "reject" | "pending_human",
  "reason": "O teu motivo claro e curto (apenas em caso de reject ou pending_human, para o motorista ler ou admin ver).",
  "confidence": 0.95
}`;

    const res = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
            prompt,
            { inlineData: { data: base64Image, mimeType } }
        ],
        config: {
            responseMimeType: 'application/json'
        }
    });

    const aiResult = JSON.parse(res.text || '{"action":"pending_human", "reason":"Erro ao interpretar resposta da IA", "confidence": 0.0}');

    // Executar Acção da IA (Com Blindagem Adicional)
    let newStatus = 'pending_human';
    const reasonLower = (aiResult.reason || '').toLowerCase();
    
    if (aiResult.confidence !== undefined && aiResult.confidence < 0.7) {
        newStatus = 'pending_human';
        aiResult.reason = "IA com baixa confiança (" + aiResult.confidence + "). Necessita avaliação humana.";
    } else if (reasonLower.includes('unclear') || reasonLower.includes('not visible') || reasonLower.includes('blur')) {
        newStatus = 'pending_human';
        aiResult.reason = "IA detectou má qualidade de imagem. Necessita avaliação humana.";
    } else {
        if (aiResult.action === 'approve') newStatus = 'approved';
        if (aiResult.action === 'reject') newStatus = 'rejected';
    }

    await updateDocument(documentId, newStatus, aiResult.reason, user.id);

    return respond('Analise concluída', 200, corsHeaders, { 
        status: newStatus,
        reason: aiResult.reason 
    });

  } catch (e) {
    console.error('[sentinel-vision] Erro:', e);
    return respond('Erro interno no Sentinel.', 500, corsHeaders);
  }
});

async function updateDocument(id: string, status: string, feedback: string, adminId: string) {
    await admin.from('driver_documents').update({
        status,
        ai_feedback: status === 'approved' ? 'Aprovado pelo Sentinel.' : feedback
    }).eq('id', id);

    // Guardar Event Log (Nivel 3 Memoria)
    await admin.from('ai_event_logs').insert({
        user_id: adminId,
        agent_role: 'sentinel',
        action_type: status === 'approved' ? 'approve_driver' : (status === 'rejected' ? 'reject_driver' : 'request_human_review'),
        target_id: id,
        details: { reason: feedback }
    });
}
