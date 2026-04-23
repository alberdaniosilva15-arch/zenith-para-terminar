import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';

interface DriverProfileLite {
  name: string | null;
  phone: string | null;
}

interface DriverDocument {
  id: string;
  driver_id: string;
  car_brand: string;
  car_model: string;
  car_plate: string;
  car_color: string;
  bi_image_url: string | null;
  bi_storage_path?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  profiles?: DriverProfileLite[] | null;
}

export function AdminDriverDocs() {
  const [docs, setDocs] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const { showToast } = useAppStore();

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('driver_documents')
        .select(`
          id, driver_id, car_brand, car_model, car_plate, car_color, bi_image_url, bi_storage_path, status, created_at,
          profiles:driver_id(name, phone)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocs((data ?? []) as DriverDocument[]);
    } catch {
      showToast('Falha ao carregar documentos', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const getBiUrl = async (doc: DriverDocument): Promise<string | null> => {
    if (doc.bi_storage_path) {
      const { data, error } = await supabase.storage
        .from('driver_docs')
        .createSignedUrl(doc.bi_storage_path, 60 * 5);
      if (error) throw error;
      return data?.signedUrl ?? null;
    }
    return doc.bi_image_url ?? null;
  };

  const openBiDocument = async (doc: DriverDocument) => {
    setOpeningDocId(doc.id);
    try {
      const url = await getBiUrl(doc);
      if (!url) {
        showToast('Nenhum BI anexado para este motorista.', 'error');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      showToast('Nao foi possivel gerar acesso ao BI.', 'error');
    } finally {
      setOpeningDocId(null);
    }
  };

  const handleUpdateStatus = async (docId: string, status: 'approved' | 'rejected') => {
    try {
      const { error } = await supabase
        .from('driver_documents')
        .update({ status })
        .eq('id', docId);

      if (error) throw error;
      showToast(`Documento ${status === 'approved' ? 'Aprovado' : 'Rejeitado'} com sucesso`, 'success');
      fetchDocs();
    } catch {
      showToast('Erro ao atualizar status', 'error');
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-black text-on-surface">Auditoria de Viaturas</h2>
          <p className="text-[10px] text-on-surface-variant font-bold uppercase">Area restrita de aprovacao de BIs e Matriculas</p>
        </div>
        <button onClick={fetchDocs} className="bg-surface-container-low text-[10px] font-black uppercase px-4 py-2 rounded-xl text-primary">
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex justify-center items-center text-on-surface-variant text-sm font-bold animate-pulse">A carregar registos seguros...</div>
      ) : docs.length === 0 ? (
        <div className="flex-1 flex justify-center items-center text-on-surface-variant text-sm font-bold">Nenhum documento submetido ainda.</div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4">
          {docs.map(d => (
            <div key={d.id} className="bg-surface-container-low border border-outline-variant rounded-[2rem] overflow-hidden">
              <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container/50">
                <div>
                  <p className="text-sm font-black text-white">{d.profiles?.[0]?.name || 'Desconhecido'}</p>
                  <p className="text-[10px] text-on-surface-variant font-bold">{d.profiles?.[0]?.phone || 'Sem terminal'} - Submetido em {new Date(d.created_at).toLocaleDateString('pt-AO')}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${
                  d.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                  d.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {d.status === 'approved' ? 'Aprovado' : d.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                </span>
              </div>

              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest mb-3">Dados da Viatura</h4>
                  <div className="space-y-2">
                    <p className="text-xs"><span className="text-on-surface-variant">Marca e Modelo:</span> <strong className="text-white">{d.car_brand} {d.car_model}</strong></p>
                    <p className="text-xs"><span className="text-on-surface-variant">Cor:</span> <strong className="text-white">{d.car_color}</strong></p>
                    <div className="bg-[#0A0A0A] border border-outline-variant rounded-lg p-2 mt-2 w-max">
                      <p className="text-sm font-black text-primary tracking-[0.2em]">{d.car_plate}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest mb-3">Documento BI</h4>
                  {(d.bi_storage_path || d.bi_image_url) ? (
                    <button
                      onClick={() => openBiDocument(d)}
                      disabled={openingDocId === d.id}
                      className="w-full max-w-[220px] py-3 px-4 text-[10px] font-black uppercase bg-surface-container rounded-xl border border-outline-variant hover:border-primary transition-colors disabled:opacity-50"
                    >
                      {openingDocId === d.id ? 'A gerar link seguro...' : 'Abrir BI (link seguro)'}
                    </button>
                  ) : (
                    <div className="w-full max-w-[220px] py-3 px-4 bg-surface-container rounded-xl flex items-center justify-center text-[10px] text-on-surface-variant font-bold border border-outline-variant border-dashed">
                      Fotografia nao enviada
                    </div>
                  )}
                </div>
              </div>

              {d.status === 'pending' && (
                <div className="p-3 border-t border-outline-variant bg-surface-container/30 flex gap-2 justify-end">
                  <button onClick={() => handleUpdateStatus(d.id, 'rejected')} className="px-6 py-2 text-[10px] font-black uppercase text-red-400 hover:bg-red-500/10 rounded-xl transition-colors">Rejeitar</button>
                  <button onClick={() => handleUpdateStatus(d.id, 'approved')} className="px-6 py-2 text-[10px] font-black uppercase bg-primary text-[#0A0A0A] rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">Autorizar Motorista</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
