import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckCircle, XCircle } from 'lucide-react';

interface DriverProfileLite {
  user_id: string;
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
  profiles?: {
    name: string | null;
    phone: string | null;
  };
}

export const DriversDocs: React.FC = () => {
  const [docs, setDocs] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: docsData, error: docsError } = await supabase
        .from('driver_documents')
        .select('id, driver_id, car_brand, car_model, car_plate, car_color, bi_image_url, bi_storage_path, status, created_at')
        .order('created_at', { ascending: false });

      if (docsError) {
        console.error('[fetchDocs] Erro ao buscar documentos:', docsError);
        throw docsError;
      }

      const driverIds = (docsData || []).map(d => d.driver_id);
      let profilesData: DriverProfileLite[] = [];

      if (driverIds.length > 0) {
        const { data: pData, error: pError } = await supabase
          .from('profiles')
          .select('user_id, name, phone')
          .in('user_id', driverIds);
        
        if (pError) {
          console.error('[fetchDocs] Erro ao buscar perfis:', pError);
          // Não falha o carregamento total se apenas os perfis falharem, 
          // mas permite que o admin saiba que há um problema de RLS
        }
        profilesData = (pData || []) as DriverProfileLite[];
      }

      const combined: DriverDocument[] = (docsData || []).map(doc => {
        const prof = profilesData.find(p => p.user_id === doc.driver_id);
        return {
          ...(doc as DriverDocument),
          profiles: { name: prof?.name ?? null, phone: prof?.phone ?? null },
        };
      });

      setDocs(combined);
    } catch (err: any) {
      alert(`Falha ao carregar documentos: ${err.message || 'Erro de conexão'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleUpdateStatus = async (docId: string, status: 'approved' | 'rejected') => {
    try {
      if (status === 'approved') {
        // ✅ USAR RPC ATÓMICA PARA APROVAÇÃO (Aprova doc + Promove User)
        const { data, error } = await supabase.rpc('approve_driver_document', { p_doc_id: docId });
        
        if (error) throw error;
        if (data?.success === false) throw new Error(data.reason);
        
        alert('Motorista aprovado e promovido com sucesso!');
      } else {
        // Rejeição simples
        const { error } = await supabase
          .from('driver_documents')
          .update({ status: 'rejected' })
          .eq('id', docId);

        if (error) throw error;
        alert('Documento rejeitado.');
      }
      
      fetchDocs();
    } catch (err: any) {
      console.error('[handleUpdateStatus] Erro:', err);
      alert(`Erro ao processar: ${err.message || 'Erro desconhecido'}`);
    }
  };

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
        alert('Nenhum BI anexado para este motorista');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      alert('Nao foi possivel abrir o BI');
    } finally {
      setOpeningDocId(null);
    }
  };

  const filteredDocs = docs.filter(d => filter === 'all' || d.status === filter);

  return (
    <div className="fade-in space-y-16">
      <div className="flex gap-12 items-center flex-wrap">
        <button onClick={fetchDocs} className="btn btn-ghost btn-sm">Refresh</button>
        {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendentes' : f === 'approved' ? 'Aprovados' : 'Rejeitados'}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Motorista</th>
              <th>Veiculo (Marca, Modelo, Cor)</th>
              <th>Matricula</th>
              <th>BI</th>
              <th>Estado</th>
              <th>Accoes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}><span className="spinner" /></td></tr>
            ) : filteredDocs.map(d => (
              <tr key={d.id}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '13px' }}>{d.profiles?.name || 'Desconhecido'}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{d.profiles?.phone || 'Sem terminal'}</div>
                </td>
                <td>
                  <div style={{ color: 'var(--text)' }}>{d.car_brand} {d.car_model}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Cor: {d.car_color}</div>
                </td>
                <td>
                  <span style={{ background: 'var(--bg4)', padding: '4px 8px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                    {d.car_plate}
                  </span>
                </td>
                <td>
                  {(d.bi_storage_path || d.bi_image_url) ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openBiDocument(d)}
                      disabled={openingDocId === d.id}
                      style={{ fontSize: '12px' }}
                    >
                      {openingDocId === d.id ? 'A gerar...' : 'Abrir BI'}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text3)', fontSize: '11px' }}>Nao anexado</span>
                  )}
                </td>
                <td>
                  <span className={`status status-${d.status === 'approved' ? 'online' : d.status === 'rejected' ? 'banned' : 'busy'}`}>
                    <span className="status-dot" />
                    {d.status === 'approved' ? 'Aprovado' : d.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                  </span>
                </td>
                <td>
                  {d.status === 'pending' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => handleUpdateStatus(d.id, 'approved')} title="Aprovar">
                        <CheckCircle size={14} /> Aprovar
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleUpdateStatus(d.id, 'rejected')} title="Rejeitar">
                        <XCircle size={14} /> Rejeitar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filteredDocs.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: '32px' }}>
                Nenhum documento {filter !== 'all' ? filter : ''} encontrado
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
