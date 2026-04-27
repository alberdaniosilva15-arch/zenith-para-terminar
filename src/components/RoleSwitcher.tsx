import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';

interface RoleSwitcherProps {
  compact?: boolean;
}

const ROLE_INTENT_STORAGE_KEY = 'auth_role_intent';
const LEGACY_ROLE_INTENT_STORAGE_KEY = 'oauth_role_intent';

const ROLE_META: Record<
  UserRole.PASSENGER | UserRole.DRIVER | UserRole.FLEET_OWNER,
  { icon: string; label: string; caption: string }
> = {
  [UserRole.PASSENGER]: {
    icon: 'P',
    label: 'Modo Passageiro',
    caption: 'Pedir corridas e gerir reservas premium',
  },
  [UserRole.DRIVER]: {
    icon: 'D',
    label: 'Modo Motorista',
    caption: 'Receber corridas e operar na estrada',
  },
  [UserRole.FLEET_OWNER]: {
    icon: 'F',
    label: 'Modo Frota',
    caption: 'Gerir motoristas, carros e operacao B2B',
  },
};

function persistRoleIntent(role: UserRole) {
  window.localStorage.setItem(ROLE_INTENT_STORAGE_KEY, role);
  window.localStorage.setItem(LEGACY_ROLE_INTENT_STORAGE_KEY, role);
}

export default function RoleSwitcher({ compact = false }: RoleSwitcherProps) {
  const { dbUser, role } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligible, setEligible] = useState<Array<UserRole.PASSENGER | UserRole.DRIVER | UserRole.FLEET_OWNER>>([]);

  useEffect(() => {
    if (!dbUser?.id) return;

    let active = true;

    const loadEligibleRoles = async () => {
      const [driverDocRes, fleetRes] = await Promise.all([
        supabase
          .from('driver_documents')
          .select('status')
          .eq('driver_id', dbUser.id)
          .maybeSingle(),
        supabase
          .from('fleets')
          .select('id')
          .eq('owner_id', dbUser.id)
          .limit(1)
          .maybeSingle(),
      ]);

      if (!active) return;

      const nextEligible = new Set<Array<UserRole.PASSENGER | UserRole.DRIVER | UserRole.FLEET_OWNER>[number]>();
      nextEligible.add(UserRole.PASSENGER);

      if (role === UserRole.DRIVER || driverDocRes.data?.status === 'approved') {
        nextEligible.add(UserRole.DRIVER);
      }

      if (role === UserRole.FLEET_OWNER || !!fleetRes.data) {
        nextEligible.add(UserRole.FLEET_OWNER);
      }

      setEligible(Array.from(nextEligible));
    };

    void loadEligibleRoles();

    return () => {
      active = false;
    };
  }, [dbUser?.id, role]);

  const currentRole = useMemo(() => {
    if (role === UserRole.FLEET_OWNER) return UserRole.FLEET_OWNER;
    if (role === UserRole.DRIVER) return UserRole.DRIVER;
    return UserRole.PASSENGER;
  }, [role]);

  const shouldRender =
    eligible.length >= 2 &&
    (role === UserRole.PASSENGER || role === UserRole.DRIVER || role === UserRole.FLEET_OWNER);

  if (!dbUser?.id || !shouldRender) {
    return null;
  }

  const handleSwitch = async (nextRole: UserRole.PASSENGER | UserRole.DRIVER | UserRole.FLEET_OWNER) => {
    if (nextRole === role) {
      setMenuOpen(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rpcName = nextRole === UserRole.FLEET_OWNER
        ? 'set_my_role_fleet_owner'
        : nextRole === UserRole.DRIVER
          ? 'set_my_role_driver'
          : 'set_my_role_passenger';
      const { error: rpcError } = await supabase.rpc(rpcName);

      if (rpcError) {
        throw rpcError;
      }

      persistRoleIntent(nextRole);
      window.location.replace('/');
    } catch (switchError: unknown) {
      const message = switchError instanceof Error ? switchError.message : 'Nao foi possivel trocar de modo agora.';
      setError(message);
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setMenuOpen((value) => !value)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[13px] font-black transition-all"
          title={ROLE_META[currentRole].label}
        >
          {ROLE_META[currentRole].icon}
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-10 w-56 rounded-2xl border border-white/10 bg-[#0A0A0A] p-2 shadow-2xl">
            {eligible.map((item) => (
              <button
                key={item}
                onClick={() => void handleSwitch(item)}
                disabled={loading}
                className={`w-full rounded-xl px-3 py-3 text-left transition-all ${
                  item === role ? 'bg-primary/15 text-primary' : 'text-white/80 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black">{ROLE_META[item].icon}</span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest">{ROLE_META[item].label}</p>
                    <p className="text-[10px] font-bold text-white/45 normal-case">{ROLE_META[item].caption}</p>
                  </div>
                </div>
              </button>
            ))}
            {error && (
              <p className="px-3 pb-2 pt-1 text-[10px] font-bold text-red-300">{error}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#0A0A0A] p-4 text-white">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-black">
            {ROLE_META[currentRole].icon}
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-primary/70">Modo activo</p>
            <p className="text-sm font-black">{ROLE_META[currentRole].label}</p>
          </div>
        </div>
        <button
          onClick={() => setMenuOpen((value) => !value)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest"
        >
          Trocar
        </button>
      </div>

      {menuOpen && (
        <div className="mt-4 space-y-2">
          {eligible.map((item) => (
            <button
              key={item}
              onClick={() => void handleSwitch(item)}
              disabled={loading}
              className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                item === role
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-white/10 bg-white/5 text-white hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl font-black">{ROLE_META[item].icon}</span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest">{ROLE_META[item].label}</p>
                  <p className="text-[11px] font-bold text-white/55">{ROLE_META[item].caption}</p>
                </div>
              </div>
            </button>
          ))}
          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[11px] font-bold text-red-200">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
