import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { UserRole } from '../../types';

type RoleFilter = 'all' | 'passenger' | 'driver' | 'fleet_owner' | 'admin';
type StatusFilter = 'all' | 'active' | 'suspended';

interface UserRow {
  id: string;
  email: string;
  role: UserRole;
  suspended_until: string | null;
  created_at: string;
  name: string;
  phone: string | null;
  rating: number;
  total_rides: number;
  wallet_balance: number;
}

interface AdminUsersMetrics {
  totalUsers: number;
  newToday: number;
  newThisWeek: number;
  retentionPct: number;
}

const PAGE_SIZE = 12;

export default function AdminUsersPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [metrics, setMetrics] = useState<AdminUsersMetrics>({
    totalUsers: 0,
    newToday: 0,
    newThisWeek: 0,
    retentionPct: 0,
  });
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [recentRides, setRecentRides] = useState<any[]>([]);
  const [roleDraft, setRoleDraft] = useState<UserRole>(UserRole.PASSENGER);
  const [suspendUntilDraft, setSuspendUntilDraft] = useState('');
  const [updating, setUpdating] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const loadMetrics = useCallback(async () => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [totalRes, todayRes, weekRes, ridesRes] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', startToday),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', startWeek),
      supabase.from('rides').select('passenger_id, driver_id').gte('created_at', startWeek),
    ]);

    const activeUsers = new Set<string>();
    (ridesRes.data ?? []).forEach((ride) => {
      if (ride.passenger_id) activeUsers.add(ride.passenger_id);
      if (ride.driver_id) activeUsers.add(ride.driver_id);
    });

    const totalUsers = totalRes.count ?? 0;
    setMetrics({
      totalUsers,
      newToday: todayRes.count ?? 0,
      newThisWeek: weekRes.count ?? 0,
      retentionPct: totalUsers > 0 ? Math.round((activeUsers.size / totalUsers) * 100) : 0,
    });
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('users')
      .select('id, email, role, suspended_until, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (roleFilter !== 'all') {
      query = query.eq('role', roleFilter);
    }

    if (statusFilter === 'active') {
      query = query.or(`suspended_until.is.null,suspended_until.lte.${nowIso}`);
    } else if (statusFilter === 'suspended') {
      query = query.gt('suspended_until', nowIso);
    }

    const { data: userRows, count } = await query;
    setTotalCount(count ?? 0);

    const ids = (userRows ?? []).map((row) => row.id);
    if (!ids.length) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const [profilesRes, walletsRes] = await Promise.all([
      supabase.from('profiles').select('user_id, name, phone, rating, total_rides').in('user_id', ids),
      supabase.from('wallets').select('user_id, balance').in('user_id', ids),
    ]);

    const profileMap = new Map(
      (profilesRes.data ?? []).map((profile) => [
        profile.user_id,
        {
          name: profile.name ?? 'Utilizador Zenith',
          phone: profile.phone ?? null,
          rating: Number(profile.rating ?? 0),
          total_rides: Number(profile.total_rides ?? 0),
        },
      ]),
    );
    const walletMap = new Map(
      (walletsRes.data ?? []).map((wallet) => [wallet.user_id, Number(wallet.balance ?? 0)]),
    );

    const nextUsers = (userRows ?? []).map((row) => {
      const profile = profileMap.get(row.id);
      return {
        id: row.id,
        email: row.email ?? 'sem-email',
        role: row.role as UserRole,
        suspended_until: row.suspended_until ?? null,
        created_at: row.created_at,
        name: profile?.name ?? 'Utilizador Zenith',
        phone: profile?.phone ?? null,
        rating: profile?.rating ?? 0,
        total_rides: profile?.total_rides ?? 0,
        wallet_balance: walletMap.get(row.id) ?? 0,
      };
    });

    setUsers(nextUsers);
    setLoading(false);
  }, [page, roleFilter, statusFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const openUser = async (user: UserRow) => {
    setSelectedUser(user);
    setRoleDraft(user.role);
    setSuspendUntilDraft(user.suspended_until ? user.suspended_until.slice(0, 10) : '');

    const { data } = await supabase
      .from('rides')
      .select('id, status, price_kz, created_at, origin_address, dest_address')
      .or(`passenger_id.eq.${user.id},driver_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(8);

    setRecentRides(data ?? []);
  };

  const handleUpdateRole = async () => {
    if (!selectedUser) return;
    setUpdating(true);
    await supabase.rpc('admin_set_user_role', {
      p_user_id: selectedUser.id,
      p_role: roleDraft,
    });
    await loadUsers();
    await loadMetrics();
    setSelectedUser((prev) => (prev ? { ...prev, role: roleDraft } : null));
    setUpdating(false);
  };

  const handleUpdateSuspension = async (clear = false) => {
    if (!selectedUser) return;
    setUpdating(true);

    const suspendIso = clear || !suspendUntilDraft
      ? null
      : new Date(`${suspendUntilDraft}T23:59:59`).toISOString();

    await supabase.rpc('admin_set_user_suspension', {
      p_user_id: selectedUser.id,
      p_suspended_until: suspendIso,
    });

    await loadUsers();
    await loadMetrics();
    setSelectedUser((prev) => (prev ? { ...prev, suspended_until: suspendIso } : null));
    setUpdating(false);
  };

  const selectedStatus = useMemo(() => {
    if (!selectedUser?.suspended_until) return 'Activa';
    return new Date(selectedUser.suspended_until) > new Date() ? 'Suspensa' : 'Activa';
  }, [selectedUser]);

  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Total utilizadores" value={String(metrics.totalUsers)} />
        <MetricCard label="Novos hoje" value={String(metrics.newToday)} />
        <MetricCard label="Novos semana" value={String(metrics.newThisWeek)} />
        <MetricCard label="Retenção 7d" value={`${metrics.retentionPct}%`} />
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={roleFilter}
          onChange={(event) => {
            setPage(1);
            setRoleFilter(event.target.value as RoleFilter);
          }}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
        >
          <option value="all">Todos os roles</option>
          <option value="passenger">Passageiro</option>
          <option value="driver">Motorista</option>
          <option value="fleet_owner">Frota</option>
          <option value="admin">Admin</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => {
            setPage(1);
            setStatusFilter(event.target.value as StatusFilter);
          }}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
        >
          <option value="all">Todos os estados</option>
          <option value="active">Activos</option>
          <option value="suspended">Suspensos</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5">
        <div className="grid grid-cols-[1.1fr_1.1fr_0.8fr_0.7fr_0.8fr_0.8fr_0.8fr_0.6fr] gap-3 border-b border-white/10 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white/45">
          <span>Nome</span>
          <span>Email</span>
          <span>Role</span>
          <span>Rating</span>
          <span>Corridas</span>
          <span>Status</span>
          <span>Registo</span>
          <span>Acções</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm font-bold text-white/55">A carregar utilizadores...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-white/55">Nenhum utilizador encontrado.</div>
        ) : (
          users.map((user) => {
            const isSuspended = !!user.suspended_until && new Date(user.suspended_until) > new Date();
            return (
              <div
                key={user.id}
                className="grid grid-cols-[1.1fr_1.1fr_0.8fr_0.7fr_0.8fr_0.8fr_0.8fr_0.6fr] gap-3 border-b border-white/5 px-4 py-4 text-[11px] text-white last:border-0"
              >
                <div>
                  <p className="font-black">{user.name}</p>
                  <p className="text-[10px] font-bold text-white/45">{user.phone ?? 'Sem telefone'}</p>
                </div>
                <p className="truncate font-bold text-white/70">{user.email}</p>
                <p className="font-black uppercase text-primary/80">{user.role}</p>
                <p className="font-black">{user.rating.toFixed(1)}</p>
                <p className="font-black">{user.total_rides}</p>
                <p className={`font-black ${isSuspended ? 'text-red-300' : 'text-emerald-300'}`}>
                  {isSuspended ? 'Suspenso' : 'Activo'}
                </p>
                <p className="font-bold text-white/55">{new Date(user.created_at).toLocaleDateString('pt-AO')}</p>
                <button
                  onClick={() => void openUser(user)}
                  className="rounded-full bg-primary/15 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary"
                >
                  Ver
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/45">
          Página {page} de {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page === 1}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-35"
          >
            Anterior
          </button>
          <button
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-35"
          >
            Seguinte
          </button>
        </div>
      </div>

      {selectedUser && (
        <div className="rounded-[2rem] border border-white/10 bg-[#0A0A0A] p-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-primary/70">Perfil completo</p>
              <h3 className="mt-2 text-lg font-black">{selectedUser.name}</h3>
              <p className="mt-1 text-[11px] font-bold text-white/55">
                {selectedUser.email} · Wallet {Math.round(selectedUser.wallet_balance).toLocaleString('pt-AO')} Kz
              </p>
            </div>
            <button onClick={() => setSelectedUser(null)} className="rounded-full bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white/70">
              Fechar
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Role manual</p>
              <select
                value={roleDraft}
                onChange={(event) => setRoleDraft(event.target.value as UserRole)}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-bold text-white outline-none"
              >
                <option value="passenger">Passageiro</option>
                <option value="driver">Motorista</option>
                <option value="fleet_owner">Frota</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={() => void handleUpdateRole()}
                disabled={updating}
                className="mt-3 w-full rounded-2xl bg-primary px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                Guardar role
              </button>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Estado da conta</p>
              <p className="mt-3 text-sm font-black">{selectedStatus}</p>
              <input
                type="date"
                value={suspendUntilDraft}
                onChange={(event) => setSuspendUntilDraft(event.target.value)}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-bold text-white outline-none"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void handleUpdateSuspension(false)}
                  disabled={updating}
                  className="flex-1 rounded-2xl bg-red-500/20 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-red-200 disabled:opacity-50"
                >
                  Suspender
                </button>
                <button
                  onClick={() => void handleUpdateSuspension(true)}
                  disabled={updating}
                  className="flex-1 rounded-2xl bg-emerald-500/15 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-200 disabled:opacity-50"
                >
                  Desbloquear
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Histórico de corridas</p>
            <div className="mt-4 space-y-3">
              {recentRides.length === 0 ? (
                <p className="text-sm font-bold text-white/45">Sem corridas recentes para este utilizador.</p>
              ) : (
                recentRides.map((ride) => (
                  <div key={ride.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-white">{ride.origin_address} {'->'} {ride.dest_address}</p>
                      <p className="text-sm font-black text-primary">{Math.round(Number(ride.price_kz ?? 0)).toLocaleString('pt-AO')} Kz</p>
                    </div>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/45">
                      {ride.status} · {new Date(ride.created_at).toLocaleString('pt-AO')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-white">
      <p className="text-[9px] font-black uppercase tracking-widest text-white/45">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
