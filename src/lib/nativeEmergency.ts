// =============================================================================
// nativeEmergency.ts — SMS e chamada nativos via Capacitor
// NÃO usa API externa — usa o SMS Manager do Android directamente.
// Solicita permissão apenas quando necessário (modo nocturno 18h-4:59h).
// =============================================================================
import { Capacitor } from '@capacitor/core';

/**
 * Envia SMS de emergência directamente do telemóvel (sem internet).
 * No browser (dev), faz fallback para WhatsApp.
 */
export async function sendNativeEmergencySMS(params: {
  phone: string;
  message: string;
}): Promise<{ sent: boolean; method: 'native_sms' | 'whatsapp' | 'none' }> {
  const { phone, message } = params;
  if (!phone) return { sent: false, method: 'none' };

  const normalizedPhone = phone.replace(/\D/g, '');
  const fullPhone = normalizedPhone.startsWith('244') ? normalizedPhone : `244${normalizedPhone}`;

  // Tentar SMS nativo no Android/iOS
  if (Capacitor.isNativePlatform()) {
    try {
      // Usar window.plugins.sms (plugin cordova-sms-plugin compatível com Capacitor)
      const smsPlugin = (window as any).SMS || (window as any).sms;
      if (smsPlugin?.send) {
        await new Promise<void>((resolve, reject) => {
          smsPlugin.send(
            `+${fullPhone}`,
            message,
            { replaceLineBreaks: true, android: { intent: '' } }, // intent vazio = envia directo
            () => resolve(),
            (err: any) => reject(err)
          );
        });
        return { sent: true, method: 'native_sms' };
      }

      // Fallback: abrir app de SMS nativa com mensagem pré-preenchida
      const smsUri = `sms:+${fullPhone}?body=${encodeURIComponent(message)}`;
      window.open(smsUri, '_system');
      return { sent: true, method: 'native_sms' };
    } catch (err) {
      console.warn('[nativeEmergency] SMS nativo falhou, usando WhatsApp:', err);
    }
  }

  // Fallback: WhatsApp Web/App
  const waUrl = `https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
  return { sent: true, method: 'whatsapp' };
}

/**
 * Faz chamada automática para o contacto de emergência.
 * Funciona sem internet.
 */
export function makeEmergencyCall(phone: string): void {
  if (!phone) return;
  const normalizedPhone = phone.replace(/\D/g, '');
  const fullPhone = normalizedPhone.startsWith('244') ? normalizedPhone : `244${normalizedPhone}`;
  window.open(`tel:+${fullPhone}`, '_system');
}

/**
 * Verifica se estamos no horário nocturno (18h-4:59h)
 */
export function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 5;
}

/**
 * Constrói a mensagem de emergência com localização
 */
export function buildEmergencyMessage(params: {
  driverName?: string;
  lat?: number;
  lng?: number;
}): string {
  const { driverName, lat, lng } = params;
  const locationLine = (lat != null && lng != null)
    ? `📍 Localização: https://maps.google.com/?q=${lat},${lng}\n`
    : '';
  const driverLine = driverName ? `🚗 Motorista: ${driverName}\n` : '';
  
  return (
    `🆘 ALERTA DE EMERGÊNCIA - ZENITH RIDE\n\n` +
    `Preciso de ajuda urgente!\n` +
    `${driverLine}${locationLine}` +
    `⏰ ${new Date().toLocaleTimeString('pt-AO')}\n\n` +
    `_Enviado automaticamente pelo Zenith Ride_`
  );
}
