import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';

interface Props {
  driverId: string;
  onClose: () => void;
  onSuccess: (status: string) => void;
}

export function DriverDocumentsForm({ driverId, onClose, onSuccess }: Props) {
  const [carBrand, setCarBrand] = useState('');
  const [carModel, setCarModel] = useState('');
  const [carPlate, setCarPlate] = useState('');
  const [carColor, setCarColor] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [biFile, setBiFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useAppStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carBrand || !carModel || !carPlate || !carColor) {
      return showToast('Preenche todos os dados do veículo.', 'error');
    }
    
    setLoading(true);
    let biStoragePath: string | null = null;

    try {
      // 1. Upload da imagem (se providenciada)
      if (biFile) {
        const fileExt = biFile.name.split('.').pop();
        const fileName = `${driverId}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `${driverId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('driver_docs')
          .upload(filePath, biFile);

        if (uploadError) throw uploadError;

        biStoragePath = filePath;
      }

      // 2. Registar base de dados
      const payload: Record<string, unknown> = {
        driver_id: driverId,
        car_brand: carBrand,
        car_model: carModel,
        car_plate: carPlate,
        car_color: carColor,
        status: 'pending',
        expires_at: expiryDate || null,
        updated_at: new Date().toISOString()
      };

      if (biStoragePath) {
        payload.bi_storage_path = biStoragePath;
        payload.bi_image_url = null;
      }

      const { error } = await supabase
        .from('driver_documents')
        .upsert(payload, { onConflict: 'driver_id' });

      if (error) throw error;

      showToast('Documentos enviados! Aguarda a aprovação por um Administrador.', 'success');
      onSuccess('pending');
    } catch (err: any) {
      console.error(err);
      showToast('Falha ao enviar documentos: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[999] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface-container-low border border-outline-variant rounded-[2rem] w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-outline-variant flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black text-white uppercase tracking-widest">
            Validação Obrigatória
          </h2>
          <button onClick={onClose} className="text-on-surface-variant font-black">✕</button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-xs text-on-surface-variant mb-6">
            Por razões de segurança, os passageiros e a Zenith Ride precisam conhecer o teu veículo e verificar a tua identidade antes de ficares ONLINE.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-on-surface font-bold uppercase">Marca</span>
                <input required value={carBrand} onChange={e=>setCarBrand(e.target.value)} placeholder="Ex: Toyota" className="bg-surface-container border border-outline-variant p-3 rounded-xl text-white text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-on-surface font-bold uppercase">Modelo</span>
                <input required value={carModel} onChange={e=>setCarModel(e.target.value)} placeholder="Ex: Corolla" className="bg-surface-container border border-outline-variant p-3 rounded-xl text-white text-sm" />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-on-surface font-bold uppercase">Matrícula</span>
              <input required value={carPlate} onChange={e=>setCarPlate(e.target.value)} placeholder="Ex: LD-01-02-AB" className="bg-surface-container border text-center border-outline-variant p-3 rounded-xl text-primary font-black tracking-[0.2em] uppercase text-sm" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-on-surface font-bold uppercase">Cor do Veículo</span>
              <input required value={carColor} onChange={e=>setCarColor(e.target.value)} placeholder="Ex: Branco" className="bg-surface-container border border-outline-variant p-3 rounded-xl text-white text-sm" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-on-surface font-bold uppercase">Validade dos Documentos</span>
              <input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} className="bg-surface-container border border-outline-variant p-3 rounded-xl text-white text-sm" />
            </label>

            <label className="flex flex-col gap-1 mt-2">
              <span className="text-[10px] text-primary font-bold uppercase">Fotografia do BILHETE (Opcional por agora)</span>
              <input type="file" accept="image/*" onChange={e => setBiFile(e.target.files?.[0] || null)} className="bg-surface-container border border-outline-variant p-3 rounded-xl text-white text-xs file:bg-primary file:text-white file:border-0 file:px-3 file:py-1 file:rounded-full file:text-[10px] file:font-bold file:mr-3" />
            </label>

            <button disabled={loading} type="submit" className="mt-4 bg-primary text-white font-black text-sm uppercase py-4 rounded-2xl active:scale-95 transition-transform disabled:opacity-50">
              {loading ? 'A Enviar...' : 'Submeter Para Revisão'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
