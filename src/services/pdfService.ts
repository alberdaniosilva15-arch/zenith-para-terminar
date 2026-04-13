import jsPDF from 'jspdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

export interface RideReceiptData {
  passengerName:   string;
  driverName:      string;
  driverPlate:     string;
  rideId:          string;
  acceptedAt:      string;   // ISO
  startedAt:       string;
  completedAt:     string;
  originAddress:   string;
  destAddress:     string;
  originLat:       number;
  originLng:       number;
  destLat:         number;
  destLng:         number;
  distanceKm:      number;
  durationMin:     number;
  priceKz:         number;
  trafficFactor:   number;   // >1.3 = engarrafamento
  vehicleType:     'standard' | 'moto' | 'comfort' | 'xl';
}

export interface ContractData {
  id: string;
  title: string;
  contract_type: 'school' | 'family' | 'corporate';
  address: string;
  time_start: string;
  time_end: string;
  km_accumulated: number;
  bonus_kz: number;
  route_deviation_alert: boolean;
  max_deviation_km: number;
  parent_monitoring: boolean;
}

// ── Busca imagem do mapa como base64 ────────────────────────────────────────
async function getMapImageBase64(data: RideReceiptData): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const pin1 = `pin-l-a+1D9E75(${data.originLng},${data.originLat})`;
    const pin2 = `pin-l-b+E24B4A(${data.destLng},${data.destLat})`;
    const url = [
      'https://api.mapbox.com/styles/v1/mapbox/dark-v11/static',
      `${pin1},${pin2}`,
      'auto/580x220@2x',
      `?padding=50&access_token=${MAPBOX_TOKEN}`,
    ].join('/');

    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Formata hora em PT ───────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-AO', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── Gera o PDF e devolve base64 ──────────────────────────────────────────────
export async function buildReceiptPDF(data: RideReceiptData): Promise<string> {
  const doc   = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W     = 210;
  const MARGIN = 15;
  let y       = 0;

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, W, 42, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text('ZENITH', MARGIN, 18);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text('RIDE', MARGIN + 38, 18);
  doc.text('RECIBO DE CORRIDA', MARGIN, 26);
  doc.text(`Ref: #${data.rideId.substring(0, 8).toUpperCase()}`, MARGIN, 33);

  doc.setTextColor(150, 150, 150);
  doc.text(fmtDate(data.completedAt), W - MARGIN, 26, { align: 'right' });

  y = 52;

  // ── Linha divisória ─────────────────────────────────────────────────────────
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y - 2, W - MARGIN, y - 2);

  // ── Participantes ───────────────────────────────────────────────────────────
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(MARGIN, y, W - MARGIN * 2, 28, 3, 3, 'F');

  const halfX = MARGIN + (W - MARGIN * 2) / 2;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 140, 140);
  doc.text('PASSAGEIRO', MARGIN + 6, y + 7);
  doc.text('MOTORISTA', halfX + 4, y + 7);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(data.passengerName, MARGIN + 6, y + 15);
  doc.text(data.driverName, halfX + 4, y + 15);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Passageiro', MARGIN + 6, y + 22);
  doc.text(data.driverPlate ? `Matrícula: ${data.driverPlate}` : 'Motorista Zenith', halfX + 4, y + 22);

  y += 36;

  // ── Rota ────────────────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('PARTIDA', MARGIN, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20, 20, 20);
  y += 5;
  const originLines = doc.splitTextToSize(data.originAddress, W - MARGIN * 2 - 10);
  doc.text(originLines, MARGIN + 4, y);
  y += originLines.length * 5 + 3;

  // Seta
  doc.setTextColor(29, 158, 117); // verde
  doc.setFontSize(12);
  doc.text('↓', MARGIN + 1, y);
  y += 6;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('DESTINO', MARGIN, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20, 20, 20);
  y += 5;
  const destLines = doc.splitTextToSize(data.destAddress, W - MARGIN * 2 - 10);
  doc.text(destLines, MARGIN + 4, y);
  y += destLines.length * 5 + 8;

  // ── Mapa ─────────────────────────────────────────────────────────────────────
  const mapBase64 = await getMapImageBase64(data);
  if (mapBase64) {
    doc.addImage(mapBase64, 'PNG', MARGIN, y, W - MARGIN * 2, 44);
    y += 49;
  }

  // ── Métricas ─────────────────────────────────────────────────────────────────
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(MARGIN, y, W - MARGIN * 2, 26, 3, 3, 'F');

  const hasTraffic = data.trafficFactor >= 1.3;
  const cols = [
    { label: 'DISTÂNCIA',   value: `${data.distanceKm.toFixed(1)} km` },
    { label: 'DURAÇÃO',     value: `${data.durationMin} min` },
    { label: 'VEÍCULO',     value: data.vehicleType === 'moto' ? 'Moto-táxi' : data.vehicleType.charAt(0).toUpperCase() + data.vehicleType.slice(1) },
    { label: 'TRÁFEGO',     value: hasTraffic ? `×${data.trafficFactor.toFixed(1)} \uD83D\uDED1` : 'Normal \u2713' },
  ];
  const colW = (W - MARGIN * 2) / 4;

  cols.forEach((col, i) => {
    const cx = MARGIN + i * colW + colW / 2;
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(col.label, cx, y + 8, { align: 'center' });
    doc.setFontSize(9.5);
    if (hasTraffic && col.label === 'TRÁFEGO') doc.setTextColor(200, 0, 0);
    else doc.setTextColor(20, 20, 20);
    doc.text(col.value, cx, y + 18, { align: 'center' });
  });
  y += 33;

  // ── Cronologia ───────────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('CRONOLOGIA', MARGIN, y);
  y += 6;

  const timeline = [
    { label: 'Motorista aceitou a corrida', iso: data.acceptedAt },
    { label: 'Viagem iniciada',              iso: data.startedAt },
    { label: 'Chegada ao destino',           iso: data.completedAt },
  ];
  timeline.forEach(t => {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 50);
    doc.text(`\u2022 ${t.label}`, MARGIN + 2, y);
    doc.setTextColor(120, 120, 120);
    doc.text(fmtTime(t.iso), W - MARGIN, y, { align: 'right' });
    y += 6;
  });
  y += 6;

  // ── Preço total ──────────────────────────────────────────────────────────────
  doc.setFillColor(10, 10, 10);
  doc.roundedRect(MARGIN, y, W - MARGIN * 2, 22, 3, 3, 'F');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 160, 160);
  doc.text('TOTAL PAGO', MARGIN + 6, y + 9);
  doc.text('Kwanza Angolano', MARGIN + 6, y + 15);

  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`${Math.round(data.priceKz).toLocaleString('pt-PT')} AOA`, W - MARGIN - 4, y + 14, { align: 'right' });

  y += 30;

  // ── Rodapé ───────────────────────────────────────────────────────────────────
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text('Zenith Ride \u00B7 Mobilidade Urbana Angola \u00B7 zenithride.ao', W / 2, y, { align: 'center' });
  doc.text('Este documento \u00E9 v\u00E1lido como comprovativo de servi\u00E7o prestado.', W / 2, y + 4, { align: 'center' });

  // Devolve base64 (sem o prefixo "data:application/pdf;base64,")
  return doc.output('datauristring').split(',')[1];
}

// ── Gera o PDF de Contrato ──────────────────────────────────────────────────
export async function buildContractPDF(c: ContractData): Promise<string> {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
  const W    = 210;
  const M    = 15;
  let y      = 0;

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, W, 40, 'F');
  doc.setFontSize(22); doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('ZENITH RIDE', M, 17);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text('CONTRATO DE SERVI\u00C7O', M, 25);
  doc.text(new Date().toLocaleDateString('pt-AO'), W - M, 25, { align: 'right' });

  y = 52;
  doc.setFontSize(13); doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(c.title, M, y); y += 8;

  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  const typeMap = { school: 'Escolar', family: 'Familiar', corporate: 'Empresarial' };
  const type = typeMap[c.contract_type] || 'Servi\u00E7o';
  doc.text(`Tipo: Contrato ${type}`, M, y); y += 6;
  doc.text(`Morada: ${c.address}`, M, y); y += 6;
  doc.text(`Hor\u00E1rio: ${c.time_start} \u2014 ${c.time_end}`, M, y); y += 6;
  doc.text(`Km acumulados: ${c.km_accumulated.toFixed(1)} km`, M, y); y += 6;
  doc.text(`B\u00F3nus dispon\u00EDvel: ${c.bonus_kz.toFixed(0)} AOA`, M, y); y += 6;
  if (c.route_deviation_alert) {
    doc.text(`Alerta de desvio activo (m\u00E1x. ${c.max_deviation_km} km)`, M, y); y += 6;
  }
  if (c.parent_monitoring) {
    y += 3;
    doc.setFillColor(240, 250, 245);
    doc.roundedRect(M, y, W - M * 2, 14, 2, 2, 'F');
    doc.setTextColor(10, 100, 60);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Monitoriza\u00E7\u00E3o parental activa', M + 4, y + 6);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text('Usa o bot\u00E3o "Partilhar Rastreio" para enviar o link em tempo real.', M + 4, y + 11);
    y += 20;
  }

  y = 255;
  doc.setFontSize(6.5); doc.setTextColor(180, 180, 180);
  doc.text('Zenith Ride \u00B7 Mobilidade Urbana Angola', W / 2, y, { align: 'center' });

  return doc.output('datauristring').split(',')[1];
}

// ── Generic Save File ───────────────────────────────────────────────────────
export async function saveFile(base64: string, fileName: string, directory: any = Directory.Documents): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path:      fileName,
      data:      base64,
      directory,
      encoding:  'base64' as any,
      recursive: true,
    });
    return result.uri;
  }

  const byteChars = atob(base64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return url;
}

// ── Generic Share File ──────────────────────────────────────────────────────
export async function shareFile(uriOrBase64: string, fileName: string, options: { title: string; text?: string; dialogTitle?: string }): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title:       options.title,
      text:        options.text,
      url:          uriOrBase64,
      dialogTitle: options.dialogTitle ?? 'Partilhar ficheiro',
    });
  } else {
    if (navigator.share) {
      try {
        const base64Data = uriOrBase64.includes(',') ? uriOrBase64.split(',')[1] : uriOrBase64;
        const byteChars = atob(base64Data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const file = new File([byteArray], fileName, { type: 'application/pdf' });
        await navigator.share({
          title: options.title,
          text:  options.text,
          files: [file],
        });
      } catch {
        console.warn('Web Share API falhou ou não suporta ficheiros.');
      }
    }
  }
}

// ── Guarda no telemóvel (específico para recibos) ───────────────────────────
export async function saveReceiptToPhone(base64: string, rideId: string): Promise<string> {
  const fileName = `zenith_recibo_${rideId.substring(0, 8)}.pdf`;
  return saveFile(base64, fileName, Directory.Documents);
}

// ── Partilha o ficheiro (específico para recibos) ───────────────────────────
export async function shareReceipt(uri: string, rideId: string): Promise<void> {
  return shareFile(uri, `zenith_recibo_${rideId.substring(0, 8)}.pdf`, {
    title: 'Recibo Zenith Ride',
    text:  `Recibo da corrida #${rideId.substring(0, 8).toUpperCase()} \u2014 Zenith Ride`,
    dialogTitle: 'Partilhar ou guardar recibo',
  });
}

// ── Função principal: gera + guarda + partilha em 1 passo ────────────────────
// ✅ BUG #10 CORRIGIDO: paths nativo e web completamente separados
export async function generateAndShareReceipt(
  data: RideReceiptData,
  mode: 'save' | 'share'
): Promise<void> {
  const base64 = await buildReceiptPDF(data);
  const fileName = `zenith_recibo_${data.rideId.substring(0, 8)}.pdf`;

  if (mode === 'share') {
    if (Capacitor.isNativePlatform()) {
      // Nativo: gravar em cache temporária e partilhar URI
      const uri = await saveFile(base64, fileName, Directory.Cache);
      await shareReceipt(uri, data.rideId);
    } else {
      // ✅ BUG #10 CORRIGIDO: Web — partilhar base64 directamente,
      // SEM saveReceiptToPhone (que fazia download automático indesejado)
      await shareFile(base64, fileName, {
        title: 'Recibo Zenith Ride',
        text:  `Recibo da corrida #${data.rideId.substring(0, 8).toUpperCase()} — ${data.priceKz.toLocaleString('pt-AO')} Kz`,
      });
    }
  } else {
    // Apenas guardar
    await saveReceiptToPhone(base64, data.rideId);
  }
}
