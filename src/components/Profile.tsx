// =============================================================================
// ZENITH RIDE v3.2 — Profile.tsx
// FIXES v3.2:
//   - CORRECÇÃO: Secções agora substituem o menu ao clicar (não ficam escondidas)
//   - NOVO: Upload de avatar do passageiro (câmara/galeria → Supabase Storage)
//   - NOVO: Botão de voltar em cada secção
//   - Integrado ReferralModal
// =============================================================================

import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { DbUser, DbProfile } from '../types';
import ZenithScore from './ZenithScore';
import { ReferralModal } from './ReferralModal';
import RoleSwitcher from './RoleSwitcher';

interface ProfileProps {
  dbUser:    DbUser;
  profile:   DbProfile | null;
  onSignOut: () => Promise<void>;
}

type ProfileSection = 'main' | 'personal' | 'ia-settings' | 'security' | 'zenithscore';

const Profile: React.FC<ProfileProps> = ({ dbUser, profile, onSignOut }) => {
  const { updateProfile } = useAuth();

  const [activeSection, setActiveSection] = useState<ProfileSection>('main');
  const [showReferral,  setShowReferral]  = useState(false);

  // Alterar password
  const [newPassword, setNewPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{text: string; ok: boolean} | null>(null);

  // Avatar upload
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
        setPwdMsg({ text: 'Palavra-passe definida com sucesso!', ok: true });
        setNewPassword('');
      }
    } catch {
      setPwdMsg({ text: 'Erro ao actualizar password', ok: false });
    } finally { setPwdLoading(false); }
  };

  // Edição de perfil
  const [editName,   setEditName]   = useState(profile?.name  ?? '');
  const [editPhone,  setEditPhone]  = useState(profile?.phone ?? '');
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg,    setEditMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  const handleEditSave = async () => {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditMsg(null);
    const err = await updateProfile({ name: editName.trim(), phone: editPhone.trim() || undefined });
    setEditSaving(false);
    setEditMsg(err ? { text: err.message, ok: false } : { text: 'Guardado com sucesso!', ok: true });
    setTimeout(() => setEditMsg(null), 3000);
  };

  // ── Upload de avatar ──────────────────────────────────────────────
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !dbUser?.id) return;

    // Validar tipo e tamanho
    if (!file.type.startsWith('image/')) {
      alert('Selecciona uma imagem (JPG, PNG, etc.)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem não pode exceder 5 MB.');
      return;
    }

    setAvatarUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const filePath = `avatars/${dbUser.id}/avatar.${ext}`;

      // Upload para Supabase Storage (bucket 'avatars')
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        console.error('[Profile] Upload error:', uploadError);
        // Tentar criar bucket se não existir (fallback)
        if (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
          alert('Bucket "avatars" não encontrado no Supabase Storage. Aplica a migration 20260426_add_public_avatars_bucket.sql ou cria o bucket "avatars" como público.');
        } else {
          alert(`Erro no upload: ${uploadError.message}`);
        }
        return;
      }

      // Obter URL pública
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl;

      if (publicUrl) {
        // Guardar no perfil
        const err = await updateProfile({ avatar_url: publicUrl });
        if (err) {
          alert(`Erro ao guardar avatar: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('[Profile] Avatar upload exception:', err);
      alert('Erro ao fazer upload da foto. Verifica a tua ligação.');
    } finally {
      setAvatarUploading(false);
      // Limpar input para permitir re-upload do mesmo ficheiro
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-container-low">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface-container-low">
      <div className="flex-1 overflow-y-auto p-4 pb-28">
        <div className="flex flex-col gap-6">

          {/* Avatar + nome (sempre visível) */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="w-20 h-20 rounded-full bg-surface-container-high overflow-hidden flex items-center justify-center border-2 border-primary/30">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl text-on-surface-variant">{profile.name?.[0]?.toUpperCase() || '?'}</span>
                )}
              </div>
              {/* Botão de câmara sobre o avatar */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg border-2 border-surface-container-low active:scale-90 transition-transform"
              >
                {avatarUploading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span className="text-white text-sm">📷</span>
                )}
              </button>
              {/* Input de ficheiro escondido */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>
            <div>
              <h1 className="text-2xl font-black text-on-surface">{profile.name}</h1>
              <p className="text-sm text-on-surface-variant">{profile.level} · {profile.rating?.toFixed(1) ?? '5.0'} ⭐</p>
              <p className="text-[9px] text-primary/60 font-bold mt-1">Toca no 📷 para mudar a foto</p>
            </div>
          </div>

          {/* ── CONTEÚDO PRINCIPAL: Menu OU Secção activa ── */}
          {activeSection === 'main' ? (
            <>
              {/* Info rápida */}
              <div className="flex flex-col bg-surface-container rounded-2xl p-4 gap-1">
                <InfoItem label="Nome"      value={profile?.name  || 'Sem nome'} />
                <InfoItem label="Email"     value={dbUser?.email  || ''} />
                <InfoItem label="Telefóne"  value={profile?.phone || 'Não definido'} />
                <InfoItem label="Nível"     value={profile?.level || 'Novato'} />
                <InfoItem label="Corridas"  value={String(profile?.total_rides || 0)} />
                <InfoItem label="Avaliação" value={profile?.rating ? `${profile.rating.toFixed(1)} ⭐` : '5.0 ⭐'} />
              </div>

              {/* Menu de secções */}
              <div className="flex flex-col bg-surface-container rounded-2xl p-4 gap-1">
                <ProfileMenuItem icon="👤" label="Dados Pessoais"        onClick={() => setActiveSection('personal')} />
                <ProfileMenuItem icon="🤖" label="Configurações IA"      onClick={() => setActiveSection('ia-settings')} />
                <ProfileMenuItem icon="🔒" label="Segurança"             onClick={() => setActiveSection('security')} />
                <ProfileMenuItem icon="🏆" label="Zenith Score"          onClick={() => setActiveSection('zenithscore')} />
                <ProfileMenuItem icon="🤝" label="Traz o Mano! (+500 Kz)" onClick={() => setShowReferral(true)} />
              </div>

              <RoleSwitcher />
            </>
          ) : activeSection === 'personal' ? (
            <div className="flex flex-col bg-surface-container rounded-2xl p-5 gap-4 animate-in slide-in-from-right duration-200">
              <SectionHeader onBack={() => setActiveSection('main')} title="Dados Pessoais" />
              {editMsg && (
                <div className={`text-xs font-bold p-3 rounded-xl text-center ${
                  editMsg.ok ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-error-container/20 text-error border border-error/30'
                }`}>
                  {editMsg.text}
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/70 ml-1">Nome completo</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-primary font-bold text-on-surface"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/70 ml-1">Telefóne (+244)</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value.replace(/[^0-9+]/g, ''))}
                  placeholder="923 456 789"
                  className="w-full bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-primary font-bold text-on-surface"
                />
              </div>
              <button
                onClick={handleEditSave}
                disabled={editSaving || !editName.trim()}
                className="w-full py-4 bg-primary text-white font-black rounded-2xl text-[10px] uppercase tracking-widest disabled:opacity-60 active:scale-95 transition-all"
              >
                {editSaving ? 'A guardar...' : 'GUARDAR ALTERAÇÕES'}
              </button>
            </div>
          ) : activeSection === 'ia-settings' ? (
            <div className="flex flex-col bg-surface-container rounded-2xl p-5 gap-4 animate-in slide-in-from-right duration-200">
              <SectionHeader onBack={() => setActiveSection('main')} title="Configurações IA" />
              <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4 text-xs font-bold text-primary leading-relaxed">
                🤖 O Kaze usa a Edge Function <code className="font-mono bg-primary/10 px-1 rounded">gemini-proxy</code> no Supabase.
                A chave API é gerida exclusivamente no servidor — nunca exposta no browser.
              </div>
              <InfoItem label="Modelo"       value="Gemini 1.5 Flash (auto)" />
              <InfoItem label="Idioma"       value="Português (pt-AO)" />
              <InfoItem label="Quota diária" value="10 mensagens / corrida" />
              <InfoItem label="Voz"          value="Português PT (SpeechSynthesis)" />
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
                <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-2">Modo de IA</p>
                <p className="text-xs font-bold text-on-surface">
                  Se a Edge Function não estiver configurada, o Kaze funciona em modo local
                  com respostas pré-definidas para perguntas comuns sobre Luanda.
                </p>
              </div>
              <p className="text-[9px] text-on-surface-variant/60 font-bold text-center mt-2">
                Para mudar o modelo contacta o administrador Zenith.
              </p>
            </div>
          ) : activeSection === 'security' ? (
            <div className="flex flex-col bg-surface-container rounded-2xl p-5 gap-4 animate-in slide-in-from-right duration-200">
              <SectionHeader onBack={() => setActiveSection('main')} title="Segurança" />
              <InfoItem label="Email" value={dbUser?.email || ''} />
              <InfoItem label="Conta criada" value={dbUser?.created_at ? new Date(dbUser.created_at).toLocaleDateString('pt-AO') : '—'} />
              <InfoItem label="Suspenso até" value={
                dbUser?.suspended_until
                  ? new Date(dbUser.suspended_until).toLocaleString('pt-AO')
                  : 'Conta ativa ✅'
              } />
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4">
                <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-2">Sessões ativas</p>
                <p className="text-xs font-bold text-on-surface">1 sessão ativa neste dispositivo</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-500 mb-1">Alterar Password</p>
                {pwdMsg && (
                  <div className={`text-xs font-bold p-2 text-center rounded-xl ${pwdMsg.ok ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'}`}>
                    {pwdMsg.text}
                  </div>
                )}
                <input
                  type="password"
                  placeholder="Nova palavra-passe"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-amber-500/30 p-3 rounded-xl outline-none focus:ring-1 focus:ring-amber-500 font-bold text-on-surface text-sm"
                />
                <button
                  onClick={handleUpdatePassword}
                  disabled={pwdLoading || newPassword.length < 6}
                  className="w-full py-3 bg-amber-500 text-black font-black rounded-xl text-[10px] uppercase tracking-widest disabled:opacity-50 active:scale-95 transition-all"
                >
                  {pwdLoading ? 'A actualizar...' : 'ATUALIZAR PASSWORD'}
                </button>
              </div>
            </div>
          ) : activeSection === 'zenithscore' ? (
            <div className="flex flex-col bg-surface-container rounded-2xl p-5 gap-4 animate-in slide-in-from-right duration-200">
              <SectionHeader onBack={() => setActiveSection('main')} title="Zenith Score" />
              {dbUser ? <ZenithScore driverId={dbUser.id} /> : null}
            </div>
          ) : null}

        </div>
      </div>

      {/* Modal Traz o Mano */}
      {showReferral && (
        <ReferralModal userId={dbUser.id} onClose={() => setShowReferral(false)} />
      )}

      {/* Botão de logout */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface border-t border-outline-variant/10">
        <button
          onClick={onSignOut}
          className="w-full py-4 bg-error text-white font-black rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 transition-all"
        >
          TERMINAR SESSÃO
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// SUB-COMPONENTES
// =============================================================================

const SectionHeader: React.FC<{ onBack: () => void; title: string }> = ({ onBack, title }) => (
  <div className="flex items-center gap-4 mb-2">
    <button
      onClick={onBack}
      className="w-10 h-10 bg-surface-container-low rounded-full flex items-center justify-center text-outline font-black hover:bg-surface-container transition-all active:scale-90"
    >
      ←
    </button>
    <h2 className="text-xl font-black text-on-surface">{title}</h2>
  </div>
);

const InfoItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center py-2 border-b border-outline-variant/10 last:border-0">
    <span className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">{label}</span>
    <span className="text-xs font-bold text-on-surface-variant">{value}</span>
  </div>
);

const ProfileMenuItem: React.FC<{ icon: string; label: string; onClick: () => void }> = ({
  icon, label, onClick
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-4 p-5 hover:bg-surface-container-lowest transition-colors border-b border-outline-variant/10 last:border-0 text-left active:scale-[0.98] rounded-xl"
  >
    <span className="text-2xl w-10 text-center">{icon}</span>
    <span className="font-black text-on-surface text-sm flex-1">{label}</span>
    <span className="text-on-surface-variant/50 font-black text-lg">›</span>
  </button>
);

export default Profile;
