// src/services/referralService.ts
import { supabase } from '../lib/supabase';
import type { AppError } from '../types';

export class ReferralService {
  /**
   * Obtém o código de referral do utilizador.
   * Se não existir, gera um automaticamente e guarda no `profiles`.
   */
  static async getMyReferralCode(userId: string): Promise<{ code: string | null; error: AppError | null }> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('referral_code, name')
        .eq('user_id', userId)
        .single();

      if (error) {
        return { code: null, error: { code: error.code, message: 'Erro ao carregar código.' } };
      }

      if (data?.referral_code) {
        return { code: data.referral_code, error: null };
      }

      // Se não tem, gera um código: PRIMEIRONOME + 4 DIGITOS
      const firstName = (data?.name?.split(' ')[0] || 'ZENITH').toUpperCase().replace(/[^A-Z]/g, '');
      const code = `${firstName}${Math.floor(1000 + Math.random() * 9000)}`;

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ referral_code: code })
        .eq('user_id', userId);

      if (updErr) {
        return { code: null, error: { code: updErr.code, message: 'Erro ao gerar código.' } };
      }

      return { code, error: null };
    } catch (e) {
      return { code: null, error: { code: 'unknown', message: 'Erro desconhecido ao obter referral.' } };
    }
  }

  /**
   * Aplica um código de referral.
   * Valida se não é o próprio utilizador e cria o registo em `referrals` como pendente.
   */
  static async applyReferralCode(userId: string, code: string): Promise<{ success: boolean; message: string }> {
    try {
      // 1. Encontrar quem é o dono do código
      const { data: referrer, error: refErr } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('referral_code', code.toUpperCase())
        .single();

      if (refErr || !referrer) {
        return { success: false, message: 'Código inválido ou inexistente.' };
      }

      if (referrer.user_id === userId) {
        return { success: false, message: 'Não podes usar o teu próprio código.' };
      }

      // 2. Verificar se o utilizador já usou um código
      const { data: existing, error: existErr } = await supabase
        .from('referrals')
        .select('*')
        .eq('referred_id', userId);

      if (!existErr && existing && existing.length > 0) {
        return { success: false, message: 'Já usaste um código de convite no teu registo.' };
      }

      // 3. Criar a entrada
      const { error: insErr } = await supabase.from('referrals').insert({
        referrer_id: referrer.user_id,
        referred_id: userId,
        referral_code: code.toUpperCase(),
        status: 'pending',
        reward_kz: 500, // Defeito = 500 Kz
      });

      if (insErr) {
        return { success: false, message: 'Não foi possível aplicar o código.' };
      }

      return { success: true, message: 'Bónus de indicação registado! Completa a primeira corrida para receberes 500 Kz.' };

    } catch (e) {
      return { success: false, message: 'Erro inesperado.' };
    }
  }
}
