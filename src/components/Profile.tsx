// =============================================================================
// MOTOGO AI v2.0 — Profile.tsx
// ANTES: nome "Mário Bento" hardcoded, logout via prop, sem Supabase
// DEPOIS: dados reais do DbUser/DbProfile, avatar upload via Supabase Storage,
//         edição de perfil real, settings persistidos
// =============================================================================

import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { DbUser, DbProfile } from '../types';
import { UserRole } from '../types';
import MotoGoScore from './MotoGoScore';

interface ProfileProps {
  dbUser:    DbUser;
  profile:   DbProfile | null;
  onSignOut: () => Promise<void>;
}

type ProfileSection = 'main' | 'personal' | 'ia-settings' | 'security' | 'motogoscore';

const Profile: React.FC<ProfileProps> = ({ dbUser, profile, onSignOut }) => {
  const { role, updateProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<ProfileSection>('main');
  const [avatarUrl,     setAvatarUrl]     = useState<string | null>(profile?.avatar_url ?? null);
  const [uploading,     setUploading]     = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [saveOk,        setSaveOk]        = useState(false);
  const [editName,      setEditName]      = useState(profile?.name ?? '');
  const [editPhone,     setEditPhone]     = useState(profile?.phone ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------------
  // Upload de avatar para Supabase Storage
  // ------------------------------------------------------------------
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview imediato
    const reader = new FileReader();
    reader.onloadend = () => setAvatarUrl(reader.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      const ext  = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        alert('Apenas imagens (JPG, PNG, WEBP) são permitidas.');
        setUploading(false);
        return;
      }
      const path = `avatars/${dbUser.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('public')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('public').getPublicUrl(path);
      await updateProfile({ avatar_url: publicUrl });
      setAvatarUrl(publicUrl);
    } catch (err) {
      console.error('[Profile] Erro ao fazer upload de avatar:', err);
    } finally {
      setUploading(false);
    }
  };

  // ------------------------------------------------------------------
  // Guardar dados pessoais
  // ------------------------------------------------------------------
  const handleSave = async () => {
    setSaving(true);
    const err = await updateProfile({ name: editName, phone: editPhone || undefined });
    setSaving(false);
    if (!err) {
      setSaveOk(true);
      setTimeout(() => { setSaveOk(false); setActiveSection('main'); }, 1500);
    }
  };

  const levelColors: Record<string, string> = {
    'Novato':   'bg-surface-container-low text-on-surface-variant',
    'Bronze':   'bg-primary/15 text-primary',
    'Prata':    'bg-surface-container text-on-surface-variant',
    'Ouro':     'bg-primary/10 text-on-surface',
    'Diamante': 'bg-primary/10 text-primary',
  };

  const levelClass = levelColors[profile?.level ?? 'Novato'] ?? 'bg-surface-container-low text-on-surface-variant';

  // ------------------------------------------------------------------
  // Secções
  // ------------------------------------------------------------------
  const renderSection = () => {
    switch (activeSection) {

      // ----------------------------------------------------------------
      case 'personal':
        return (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <SectionHeader onBack={() => setActiveSection('main')} title="Dados Pessoais" />
            <div className="bg-surface-container-low p-6 rounded-[2rem] border border-outline-variant/20 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-on-surface-variant/70 uppercase ml-2 tracking-widest">Nome</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-primary font-bold text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-on-surface-variant/70 uppercase ml-2 tracking-widest">Telefone</label>
                <div className="flex bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden">
                  <span className="px-4 flex items-center text-on-surface-variant/70 font-black text-sm bg-surface-container-low border-r border-outline-variant/20">+244</span>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="9xx xxx xxx"
                    className="flex-1 bg-transparent p-4 outline-none font-bold text-on-surface text-sm"
                  />
                </div>
              </div>
              <InfoItem label="Email" value={dbUser.email} />
              <InfoItem label="Role" value={role === UserRole.DRIVER ? 'Motorista' : role === UserRole.ADMIN ? 'Admin' : 'Passageiro'} />
              <InfoItem label="Membro desde" value={new Date(dbUser.created_at).toLocaleDateString('pt-AO', { month: 'long', year: 'numeric' })} />

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-surface-container-highest text-white py-4 rounded-2xl font-black text-[9px] uppercase tracking-widest disabled:opacity-60 transition-all"
              >
                {saving ? 'A guardar...' : saveOk ? '✓ Guardado!' : 'GUARDAR ALTERAÇÕES'}
              </button>
            </div>
          </div>
        );

      // ----------------------------------------------------------------
      case 'security':
        return (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <SectionHeader onBack={() => setActiveSection('main')} title="Segurança" />
            <div className="bg-surface-container-low p-6 rounded-[2rem] border border-outline-variant/20 space-y-4">
              <InfoItem label="Email" value={dbUser.email} />
              <InfoItem
                label="Palavra-passe"
                value="••••••••"
              />
              <button
                onClick={async () => {
                  await supabase.auth.resetPasswordForEmail(dbUser.email);
                  alert('Email de recuperação enviado para ' + dbUser.email);
                }}
                className="w-full bg-surface-container-highest text-white py-4 rounded-2xl font-black text-[9px] uppercase tracking-widest"
              >
                ALTERAR PALAVRA-PASSE
              </button>
            </div>
          </div>
        );

      // ----------------------------------------------------------------
      case 'motogoscore':
        return (
          <div>
            <button onClick={() => setActiveSection('main')}
              className="flex items-center gap-2 text-on-surface-variant font-black text-sm mb-4 px-4 py-2 hover:bg-surface-container-low rounded-2xl transition-all">
              ← Voltar
            </button>
            <MotoGoScore driverId={dbUser.id} />
          </div>
        );

      // ----------------------------------------------------------------
      case 'main':
      default:
        return (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Avatar e nome */}
            <div className="flex flex-col items-center py-6">
              <div
                className="relative group cursor-pointer"
                onClick={() => !uploading && fileInputRef.current?.click()}
              >
                <div className={`w-32 h-32 rounded-full border-4 ${role === UserRole.DRIVER ? 'border-error' : 'border-primary'} p-1.5 bg-surface-container-low shadow-2xl relative z-10 overflow-hidden`}>
                  {uploading ? (
                    <div className="w-full h-full rounded-full bg-surface-container-low flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <img
                      src={`https://api.dicebear.com/7.x/bottts/svg?seed=${dbUser.id}`}
                      alt="Avatar"
                      className="w-full h-full rounded-full bg-surface-container-lowest"
                    />
                  )}
                </div>
                <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                  <span className="text-white text-[8px] font-black uppercase">MUDAR FOTO</span>
                </div>
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-surface-container-low border border-outline-variant/20 rounded-full shadow-lg flex items-center justify-center z-30">
                  <span className="text-lg">📸</span>
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
              </div>

              <h2 className="text-2xl font-black text-on-surface mt-6 tracking-tight italic">
                {profile?.name || dbUser.email.split('@')[0]}
              </h2>

              <div className="flex items-center gap-2 mt-2">
                <span className={`text-[9px] font-black px-4 py-1 rounded-full ${levelClass}`}>
                  Nível {profile?.level ?? 'Novato'}
                </span>
                {profile && (
                  <span className="text-[9px] font-black bg-primary/8 text-primary px-3 py-1 rounded-full">
                    ⭐ {profile.rating.toFixed(1)}
                  </span>
                )}
              </div>

              {profile && (
                <p className="text-[9px] text-on-surface-variant/70 font-bold mt-1">
                  {profile.total_rides} corrida{profile.total_rides !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Menu de navegação */}
            <div className="bg-surface-container-low rounded-[2.5rem] shadow-sm border border-outline-variant/10 overflow-hidden">
              <ProfileMenuItem icon="👤" label="Perfil e Dados Pessoais"  onClick={() => setActiveSection('personal')} />
              <ProfileMenuItem icon="🔒" label="Segurança"                onClick={() => setActiveSection('security')} />
              <ProfileMenuItem icon="📊" label="Estatísticas"             onClick={() => {}} />
              {/* v3.0: MotoGo Score — só para motoristas */}
              {role === UserRole.DRIVER && (
                <button
                  onClick={() => setActiveSection('motogoscore')}
                  className="w-full flex items-center justify-between p-5 bg-surface-container-low border border-primary/15 rounded-b-[2.5rem] text-left hover:bg-primary/10 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-xl">🏆</div>
                    <div>
                      <p className="font-black text-on-surface text-sm">MotoGo Score</p>
                      <p className="text-[9px] text-primary/60 font-bold uppercase tracking-widest">Score de crédito 0-1000</p>
                    </div>
                  </div>
                  <span className="text-on-surface-variant/70">›</span>
                </button>
              )}
            </div>

            {/* Logout */}
            <button
              onClick={onSignOut}
              className="w-full py-6 text-error font-black text-[10px] bg-error-container/20 rounded-[2rem] hover:bg-error-container/30 transition-all uppercase tracking-[0.2em] shadow-sm"
            >
              Sair da Conta
            </button>
          </div>
        );
    }
  };

  return <div className="p-4 pb-24">{renderSection()}</div>;
};

// =============================================================================
// SUB-COMPONENTES
// =============================================================================
const SectionHeader: React.FC<{ onBack: () => void; title: string }> = ({ onBack, title }) => (
  <div className="flex items-center gap-4">
    <button
      onClick={onBack}
      className="w-10 h-10 bg-surface-container-low rounded-full flex items-center justify-center text-outline font-black hover:bg-surface-container transition-all"
    >
      ←
    </button>
    <h2 className="text-xl font-black text-on-surface">{title}</h2>
  </div>
);

const InfoItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center py-2 border-b border-outline-variant/10">
    <span className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">{label}</span>
    <span className="text-xs font-bold text-on-surface-variant">{value}</span>
  </div>
);

const ProfileMenuItem: React.FC<{ icon: string; label: string; onClick: () => void }> = ({
  icon, label, onClick
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-4 p-5 hover:bg-surface-container-lowest transition-colors border-b border-outline-variant/10 last:border-0 text-left"
  >
    <span className="text-2xl w-10 text-center">{icon}</span>
    <span className="font-black text-on-surface text-sm flex-1">{label}</span>
    <span className="text-on-surface-variant/50 font-black">›</span>
  </button>
);

export default Profile;
