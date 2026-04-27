import React, { useMemo, useState } from 'react';
import { toDataURL } from 'qrcode';

type DevServerInfo = {
  networkUrl: string | null;
  localUrl: string | null;
};

const DevQRCode: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [serverInfo, setServerInfo] = useState<DevServerInfo | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');

  const shareUrl = useMemo(
    () => serverInfo?.networkUrl ?? serverInfo?.localUrl ?? window.location.href,
    [serverInfo],
  );

  if (!import.meta.env.DEV) {
    return null;
  }

  const loadQrCode = async () => {
    setOpen(true);
    setLoading(true);

    try {
      const response = await fetch('/__dev/network-url');
      const info = await response.json() as DevServerInfo;
      setServerInfo(info);

      const urlToEncode = info.networkUrl ?? info.localUrl ?? window.location.href;
      const dataUrl = await toDataURL(urlToEncode, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 280,
        color: {
          dark: '#0A0A0A',
          light: '#F8FAFC',
        },
      });

      setQrCodeDataUrl(dataUrl);
    } catch (error) {
      console.warn('[DevQRCode] Falha ao gerar QR code do servidor dev:', error);
      setServerInfo({
        networkUrl: null,
        localUrl: window.location.href,
      });
      setQrCodeDataUrl(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch (error) {
      console.warn('[DevQRCode] Não foi possível copiar o link:', error);
    }
  };

  return (
    <>
      <button
        onClick={() => void loadQrCode()}
        className="fixed right-4 bottom-24 z-[90] px-4 py-3 rounded-2xl bg-[#0A0A0A]/90 text-white border border-white/10 shadow-2xl backdrop-blur-md text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
      >
        📱 QR Code
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-[#0A0A0A] p-6 text-white shadow-[0_25px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-primary/80">Zenith Dev Access</p>
                <h3 className="text-lg font-black mt-1">Partilha rápida para testes</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"
              >
                ×
              </button>
            </div>

            <div className="rounded-[1.75rem] border border-white/8 bg-white px-4 py-5 flex items-center justify-center min-h-[320px]">
              {loading ? (
                <div className="flex flex-col items-center gap-3 text-[#0A0A0A]/60">
                  <div className="w-10 h-10 rounded-full border-4 border-[#0A0A0A]/15 border-t-[#0A0A0A] animate-spin" />
                  <p className="text-xs font-black uppercase tracking-widest">A gerar QR...</p>
                </div>
              ) : qrCodeDataUrl ? (
                <img src={qrCodeDataUrl} alt="QR code do servidor de desenvolvimento" className="w-72 h-72 object-contain" />
              ) : (
                <div className="text-center text-[#0A0A0A]/65 text-sm font-bold">
                  O QR não pôde ser gerado, mas o link abaixo continua disponível para partilha.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-[1.5rem] bg-white/5 border border-white/8 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-2">Link actual</p>
              <p className="text-[11px] font-mono text-white/80 break-all">{shareUrl}</p>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => void handleCopy()}
                className="flex-1 py-3 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"
              >
                {copyState === 'done' ? 'Copiado!' : 'Copiar link'}
              </button>
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/10 text-white/80 font-black text-[10px] uppercase tracking-widest text-center active:scale-95 transition-all"
              >
                Abrir
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DevQRCode;
