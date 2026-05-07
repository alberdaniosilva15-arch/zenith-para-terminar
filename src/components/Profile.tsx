import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { DbUser, DbProfile } from '../types';
import ZenithScore from './ZenithScore';
import { ReferralModal } from './ReferralModal';
import RoleSwitcher from './RoleSwitcher';
import { useAppStore } from '../store/useAppStore';
import { normalizeAngolanPhone } from '../lib/phone';

interface ProfileProps {
  dbUser:    DbUser;
  profile:   DbProfile | null;
  onSignOut: () => Promise<void>;
}

type ProfileSection = 'main' | 'personal' | 'ia-settings' | 'security' | 'zenithscore';

const Profile: React.FC<ProfileProps> = ({ dbUser, profile, onSignOut }) => {
  const { updateProfile } = useAuth();
  const showToast = useAppStore((s) => s.showToast);

  const [activeSection, setActiveSection] = useState<ProfileSection>('main');
  const [showReferral,  setShowReferral]  = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{text: string; ok: boolean} | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpdatePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setPwdMsg({ text: 'No mínimo 6 caracteres', ok: false });
      return;
    }
    setPwdLoading(true); setPwdMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) setPwdMsg({ text: error.message, ok: false });
      else {
        setPwdMsg({ text: 'Palavra-passe definida!', ok: true });
        setNewPassword('');
      }
    } catch (err) {
      console.warn('[Profile] updatePassword:', err);
      setPwdMsg({ text: 'Erro ao actualizar password', ok: false });
    } finally { setPwdLoading(false); }
  };

  const [editName,   setEditName]   = useState(profile?.name  ?? '');
  const [editPhone,  setEditPhone]  = useState(profile?.phone ?? '');
  const [editEmergency, setEditEmergency] = useState(profile?.emergency_contact_phone ?? '');
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg,    setEditMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  const handleEditSave = async () => {
    if (!editName.trim()) return;

    const normalizedPhone = editPhone.trim() ? normalizeAngolanPhone(editPhone.trim()) : null;
    if (editPhone.trim() && !normalizedPhone) {
      setEditMsg({ text: 'Telemóvel inválido. Usa 9 dígitos e começa com 9.', ok: false });
      return;
    }

    const normalizedEmergency = editEmergency.trim() ? normalizeAngolanPhone(editEmergency.trim()) : null;
    if (editEmergency.trim() && !normalizedEmergency) {
      setEditMsg({ text: 'Contacto de emergência inválido. Usa 9 dígitos e começa com 9.', ok: false });
      return;
    }

    setEditSaving(true);
    setEditMsg(null);
    const err = await updateProfile({ 
      name: editName.trim(), 
      phone: normalizedPhone || undefined,
      emergency_contact_phone: normalizedEmergency || undefined,
    });
    setEditSaving(false);
    if (!err) {
      setEditPhone(normalizedPhone || '');
      setEditEmergency(normalizedEmergency || '');
    }
    setEditMsg(err ? { text: err.message, ok: false } : { text: 'Guardado com sucesso!', ok: true });
    setTimeout(() => setEditMsg(null), 3000);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !dbUser?.id) return;

    if (!file.type.startsWith('image/')) {
      showToast('Selecciona uma imagem (JPG, PNG, etc.)', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('A imagem não pode exceder 5 MB.', 'error');
      return;
    }

    setAvatarUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const filePath = `avatars/${dbUser.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        if (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
          showToast('Bucket "avatars" não encontrado.', 'error');
        } else {
          showToast(`Erro no upload: ${uploadError.message}`, 'error');
        }
        return;
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl;

      if (publicUrl) {
        const err = await updateProfile({ avatar_url: publicUrl });
        if (err) showToast(`Erro ao guardar avatar: ${err.message}`, 'error');
      }
    } catch (err) {
      showToast('Erro ao fazer upload da foto.', 'error');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!profile) {
    return (
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      
      {/* Hero Card */}
      <div style={{ padding: '24px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div className="zr-inline" style={{ gap: '20px' }}>
          <div style={{ position: 'relative' }}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="zr-avatar zr-avatar--lg" style={{ objectFit: 'cover' }} />
            ) : (
              <div className="zr-avatar zr-avatar--lg">
                {profile.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              style={{ position: 'absolute', bottom: -4, right: -4, width: '32px', height: '32px', background: 'var(--gold)', borderRadius: '50%', border: '2px solid var(--bg)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              {avatarUploading ? '...' : <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>photo_camera</span>}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
          </div>
          <div>
            <h1 className="zr-section-title" style={{ fontSize: '24px', marginBottom: '4px' }}>{profile.name}</h1>
            <p className="zr-meta">{profile.level} · {profile.rating?.toFixed(1) ?? '5.0'} ⭐</p>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px' }}>
        
        {/* Tabs de navegação */}
        <div className="zr-scroll-x" style={{ marginBottom: '24px', marginInline: '-14px', paddingInline: '14px' }}>
          {(['main', 'personal', 'ia-settings', 'security', 'zenithscore'] as const).map(sec => (
            <button
              key={sec}
              className={`zr-tab ${activeSection === sec ? 'is-active' : ''}`}
              onClick={() => setActiveSection(sec)}
            >
              {sec === 'main' ? 'Principal' : sec === 'personal' ? 'Dados' : sec === 'ia-settings' ? 'IA' : sec === 'security' ? 'Segurança' : 'Score'}
            </button>
          ))}
        </div>

        {/* SECÇÃO PRINCIPAL */}
        {activeSection === 'main' && (
          <div className="animate-in fade-in">
            <section className="zr-card" style={{ marginBottom: '14px' }}>
              <p className="zr-kicker" style={{ marginBottom: '14px' }}>A tua conta</p>
              <div className="zr-list">
                <InfoRow label="Email" value={dbUser.email || ''} />
                <InfoRow label="Telemóvel" value={profile.phone || '—'} />
                <InfoRow label="Membro desde" value={dbUser.created_at ? new Date(dbUser.created_at).toLocaleDateString('pt-AO') : '—'} />
                <InfoRow label="Viagens" value={String(profile.total_rides || 0)} />
              </div>
            </section>

            <button className="zr-button zr-button--block zr-button--ghost" onClick={() => setShowReferral(true)} style={{ marginBottom: '14px', border: '1px solid var(--gold)', color: 'var(--gold)' }}>
              Traz o Mano! (+500 Kz)
            </button>

            <div style={{ marginBottom: '24px' }}>
              <RoleSwitcher />
            </div>

            <button className="zr-button zr-button--block zr-button--danger" onClick={onSignOut}>
              Terminar Sessão
            </button>
          </div>
        )}

        {/* DADOS PESSOAIS */}
        {activeSection === 'personal' && (
          <section className="zr-card animate-in slide-in-from-right">
            <p className="zr-kicker" style={{ marginBottom: '16px' }}>Editar Perfil</p>
            
            {editMsg && (
              <div className={`zr-alert-box ${editMsg.ok ? 'zr-alert-box--success' : 'zr-alert-box--danger'}`} style={{ marginBottom: '16px' }}>
                <div className="zr-alert-content">
                  <p>{editMsg.text}</p>
                </div>
              </div>
            )}

            <div style={{ marginBottom: '14px' }}>
              <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>Nome completo</label>
              <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="zr-input" style={{ width: '100%' }} />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>Telemóvel (+244)</label>
              <input type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value.replace(/[^0-9+]/g, ''))} className="zr-input" style={{ width: '100%' }} />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label className="zr-meta" style={{ display: 'block', marginBottom: '8px' }}>Contacto de Emergência (Telefone)</label>
              <input type="tel" value={editEmergency} onChange={e => setEditEmergency(e.target.value.replace(/[^0-9+]/g, ''))} placeholder="Nº para SOS" className="zr-input" style={{ width: '100%' }} />
            </div>

            <button onClick={handleEditSave} disabled={editSaving || !editName.trim()} className="zr-button zr-button--block">
              {editSaving ? 'A guardar...' : 'Guardar Alterações'}
            </button>
          </section>
        )}

        {/* IA */}
        {activeSection === 'ia-settings' && (
          <section className="zr-card animate-in slide-in-from-right">
            <p className="zr-kicker" style={{ marginBottom: '16px' }}>Sistema IA (Kaze)</p>
            
            <div className="zr-alert-box zr-alert-box--info" style={{ marginBottom: '20px' }}>
              <span className="material-symbols-outlined">smart_toy</span>
              <div className="zr-alert-content">
                <strong>O Kaze usa a Edge Function</strong>
                <p>A chave API é gerida no servidor.</p>
              </div>
            </div>

            <div className="zr-list">
              <InfoRow label="Modelo" value="Gemini 1.5 Flash (auto)" />
              <InfoRow label="Idioma" value="Português (pt-AO)" />
              <InfoRow label="Quota diária" value="10 msgs / corrida" />
              <InfoRow label="Voz" value="Português PT" />
            </div>
          </section>
        )}

        {/* SEGURANÇA */}
        {activeSection === 'security' && (
          <section className="zr-card animate-in slide-in-from-right">
            <p className="zr-kicker" style={{ marginBottom: '16px' }}>Autenticação</p>
            
            <div className="zr-list" style={{ marginBottom: '24px' }}>
              <InfoRow label="Sessões" value="1 activa neste dispositivo" />
              <InfoRow label="Estado" value={dbUser?.suspended_until ? 'Suspensa' : 'Activa ✅'} />
            </div>

            <p className="zr-kicker" style={{ marginBottom: '12px' }}>Alterar Palavra-passe</p>
            
            {pwdMsg && (
              <div className={`zr-alert-box ${pwdMsg.ok ? 'zr-alert-box--success' : 'zr-alert-box--danger'}`} style={{ marginBottom: '16px' }}>
                <div className="zr-alert-content"><p>{pwdMsg.text}</p></div>
              </div>
            )}

            <input 
              type="password" 
              placeholder="Nova palavra-passe" 
              value={newPassword} 
              onChange={e => setNewPassword(e.target.value)} 
              className="zr-input" 
              style={{ width: '100%', marginBottom: '16px' }} 
            />

            <button onClick={handleUpdatePassword} disabled={pwdLoading || newPassword.length < 6} className="zr-button zr-button--block zr-button--secondary">
              {pwdLoading ? 'A actualizar...' : 'Actualizar Password'}
            </button>
          </section>
        )}

        {/* SCORE */}
        {activeSection === 'zenithscore' && (
          <div className="animate-in slide-in-from-right">
            {dbUser ? <ZenithScore driverId={dbUser.id} /> : null}
          </div>
        )}

      </div>

      {showReferral && <ReferralModal userId={dbUser.id} onClose={() => setShowReferral(false)} />}
    </div>
  );
};

// Row Helper
const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="zr-list-item" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
    <span className="zr-meta" style={{ flex: 1 }}>{label}</span>
    <strong className="zr-copy">{value}</strong>
  </div>
);

export default Profile;
