import jsPDF from 'jspdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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
    { label: 'TRÁFEGO',     value: hasTraffic ? `×${data.trafficFactor.toFixed(1)} 🚦` : 'Normal ✓' },
  ];
  const colW = (W - MARGIN * 2) / 4;

  cols.forEach((col, i) => {
    const cx = MARGIN + i * colW + colW / 2;
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(col.label, cx, y + 8, { align: 'center' });
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(hasTraffic && col.label === 'TRÁFEGO' ? 200 : 20, 20, 20);
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
    doc.text(`• ${t.label}`, MARGIN + 2, y);
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
  doc.text('Zenith Ride · Mobilidade Urbana Angola · zenithride.ao', W / 2, y, { align: 'center' });
  doc.text('Este documento é válido como comprovativo de serviço prestado.', W / 2, y + 4, { align: 'center' });

  // Devolve base64 (sem o prefixo "data:application/pdf;base64,")
  return doc.output('datauristring').split(',')[1];
}

// ── Guarda no telemóvel (pasta Documentos) ──────────────────────────────────
export async function saveReceiptToPhone(
  base64: string,
  rideId: string
): Promise<string> {
  const fileName = `zenith_recibo_${rideId.substring(0, 8)}.pdf`;
  const result = await Filesystem.writeFile({
    path:        fileName,
    data:        base64,
    directory:   Directory.Documents,
    encoding:    'base64' as any,
    recursive:   true,
  });
  return result.uri;
}

// ── Partilha o ficheiro (WhatsApp, Drive, etc.) ──────────────────────────────
export async function shareReceipt(uri: string, rideId: string): Promise<void> {
  await Share.share({
    title:         'Recibo Zenith Ride',
    text:          `Recibo da corrida #${rideId.substring(0, 8).toUpperCase()} — Zenith Ride`,
    url:           uri,
    dialogTitle:   'Partilhar ou guardar recibo',
  });
}

// ── Função principal: gera + guarda + partilha em 1 passo ────────────────────
export async function generateAndShareReceipt(
  data: RideReceiptData,
  mode: 'save' | 'share'
): Promise<void> {
  const base64 = await buildReceiptPDF(data);
  const uri    = await saveReceiptToPhone(base64, data.rideId);

  if (mode === 'share') {
    await shareReceipt(uri, data.rideId);
  }
}
