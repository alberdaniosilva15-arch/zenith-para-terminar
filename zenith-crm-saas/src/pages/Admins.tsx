import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';

const Admins: React.FC = () => {
  const [emailToPromote, setEmailToPromote] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handlePromote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailToPromote) return;
    setLoading(true);
    setMsg('');
    setErrorMsg('');

    try {
      const { error } = await supabase.rpc('set_user_admin', { target_email: emailToPromote });
      if (error) throw error;

      setMsg(`Sucesso! O utilizador ${emailToPromote} tem agora privilegios de Administrador global.`);
      setEmailToPromote('');
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error
        ? err.message
        : 'Falha ao promover. Verifica se o e-mail inserido ja tem uma conta criada na App.';
      setErrorMsg(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="crm-page fade-in">
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <div>
          <h1 className="page-title">Validacao de Administradores</h1>
          <p className="page-subtitle">Gestao de permissoes administrativas validada no servidor</p>
        </div>
      </div>

      <div style={{ maxWidth: '600px', background: 'var(--bg2)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Adicionar Novo Membro da Equipa Admin</h2>
        <p style={{ color: 'var(--text3)', fontSize: '13px', marginBottom: '24px', lineHeight: '1.5' }}>
          Para manter a seguranca maxima, promocoes de administradores sao validadas no backend.
          Primeiro cria uma conta normal na aplicacao e depois promove aqui por e-mail.
        </p>

        {msg && (
          <div style={{ display: 'flex', gap: '8px', padding: '16px', background: 'rgba(0,230,118,0.1)', color: 'var(--green)', borderRadius: '8px', marginBottom: '24px', alignItems: 'center' }}>
            <CheckCircle2 size={18} /> <span style={{ fontSize: '13px' }}>{msg}</span>
          </div>
        )}

        {errorMsg && (
          <div style={{ display: 'flex', gap: '8px', padding: '16px', background: 'rgba(255,50,50,0.1)', color: 'var(--red)', borderRadius: '8px', marginBottom: '24px', alignItems: 'center' }}>
            <AlertTriangle size={18} /> <span style={{ fontSize: '13px' }}>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePromote} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label">E-mail do Utilizador a Promover</label>
            <input
              type="email"
              className="input"
              placeholder="E.g. novo.gestor@exemplo.com"
              value={emailToPromote}
              onChange={e => setEmailToPromote(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ height: '42px', padding: '0 24px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            {loading ? <span className="spinner" style={{ width: '18px', height: '18px' }} /> : <><Plus size={16} /> Promover</>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Admins;
