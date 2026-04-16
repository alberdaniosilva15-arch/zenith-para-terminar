import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, MapPin, Clock, Search, ExternalLink } from 'lucide-react';

interface ContractRow {
  id: string;
  user_id: string;
  contract_type: 'school' | 'family' | 'corporate';
  title: string;
  address: string;
  time_start: string;
  time_end: string;
  active: boolean;
  parent_monitoring: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  profiles?: { name: string; email: string };
  created_at: string;
}

const ContractsPage: React.FC = () => {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contracts')
      .select('*, profiles!contracts_user_id_fkey(name, email)')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setContracts(data as ContractRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const getTypeLabel = (t: string) => {
    if (t === 'school') return 'Escolar';
    if (t === 'family') return 'Familiar';
    return 'Empresa';
  };

  const getStatusClass = (active: boolean) => active ? 'status-pill success' : 'status-pill disabled';

  return (
    <div className="crm-page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contratos de Rotas IA</h1>
          <p className="page-subtitle">Acompanhe as rotas de fidelização (Escolar, Familiar e Empresarial)</p>
        </div>
      </div>

      <div className="table-container" style={{ background: 'var(--bg2)', borderRadius: '12px', border: '1px solid var(--border)' }}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : contracts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)' }}>
            Nenhum contrato registado.
          </div>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Nome / Tipo</th>
                <th>Cliente</th>
                <th>Morada e Horário</th>
                <th>Responsável / Contacto</th>
                <th>Estado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ padding: '6px', background: 'var(--bg3)', borderRadius: '6px' }}>
                        <FileText size={14} color="var(--primary)" />
                      </div>
                      <div>
                        <div style={{ fontWeight: '600' }}>{c.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{getTypeLabel(c.contract_type)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div>{c.profiles?.name || 'Cliente Oculto'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)' }}>ID: {c.user_id.substring(0, 8)}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                      <MapPin size={12} color="var(--primary)" /> {c.address}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                      <Clock size={12} /> {c.time_start} - {c.time_end}
                    </div>
                  </td>
                  <td>
                    <div>{c.contact_name || '-'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{c.contact_phone || ''}</div>
                  </td>
                  <td>
                    <span className={getStatusClass(c.active)}>
                      {c.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost" title="Detalhes" style={{ padding: '4px' }}>
                      <ExternalLink size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ContractsPage;
