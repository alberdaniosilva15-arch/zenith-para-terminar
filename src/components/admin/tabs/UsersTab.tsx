import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

interface UserRow {
  id: string;
  email: string | null;
  role: string | null;
  suspended_until: string | null;
  created_at: string;
  full_name: string | null;
  total_rides: number;
}

const PAGE_SIZE = 12;

export const UsersTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchUsers = async (activePage = page, activeQuery = searchQuery) => {
    setLoading(true);
    setError(null);

    try {
      const from = (activePage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('users')
        .select('id, email, role, suspended_until, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (activeQuery.trim()) {
        query = query.ilike('email', `%${activeQuery.trim()}%`);
      }

      const { data: userRows, count, error: queryError } = await query;
      if (queryError) throw queryError;

      setTotalCount(count ?? 0);

      const ids = (userRows ?? []).map((user) => user.id);
      if (ids.length === 0) {
        setUsers([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, name, total_rides')
        .in('user_id', ids);

      if (profilesError) throw profilesError;

      const profileMap = new Map(
        (profiles ?? []).map((profile) => [
          profile.user_id,
          {
            name: profile.name ?? null,
            total_rides: Number(profile.total_rides ?? 0),
          },
        ]),
      );

      setUsers(
        (userRows ?? []).map((user) => {
          const profile = profileMap.get(user.id);
          return {
            id: user.id,
            email: user.email ?? null,
            role: user.role ?? null,
            suspended_until: user.suspended_until ?? null,
            created_at: user.created_at,
            full_name: profile?.name ?? null,
            total_rides: profile?.total_rides ?? 0,
          };
        }),
      );
    } catch (e: any) {
      console.error('[UsersTab.fetchUsers]', e);
      setError(e.message || 'Falha de rede. Verifica a ligacao ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      setSearchQuery(searchInput.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    void fetchUsers(page, searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchQuery]);

  return (
    <div className="w-full h-full overflow-y-auto px-margin-desktop py-lg max-w-[1600px] mx-auto pb-24 bg-[#000000]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-xl">
        <div>
          <h2 className="font-headline-xl text-on-surface mb-2 tracking-tight">Utilizadores e Crescimento</h2>
          <p className="font-body-sm text-on-surface-variant">Analise demografica em tempo real e monitorizacao de lealdade.</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-surface-container border border-primary/20 text-on-surface font-label-md uppercase rounded hover:border-primary/50 transition-colors">Global</button>
          <button className="px-4 py-2 bg-primary/10 border border-primary text-primary font-label-md uppercase rounded shadow-[0_0_10px_rgba(212,175,55,0.1)]">Luanda</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="material-symbols-outlined text-5xl text-red-400">cloud_off</span>
          <p className="text-sm text-red-400 max-w-sm">{error}</p>
          <button
            onClick={() => void fetchUsers()}
            className="mt-2 px-5 py-2 text-sm rounded border border-white/20 text-white/70 hover:bg-white/10 transition-colors"
          >
            Tentar Novamente
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col gap-6 items-center justify-center py-20 text-center opacity-70">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant">group</span>
          <p className="font-body-lg text-on-surface-variant">
            {searchQuery ? 'Nenhum utilizador encontrado para esta pesquisa.' : 'Nenhum utilizador encontrado no sistema.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 bg-[#050505]/90 border border-primary/15 rounded-xl flex flex-col overflow-hidden shadow-sm">
            <div className="p-6 border-b border-primary/10 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="relative w-full sm:w-72">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[20px]">search</span>
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  className="w-full bg-[#0A0A0A] border border-primary/20 text-on-surface font-body-sm rounded pl-10 pr-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary/50 focus:outline-none transition-all placeholder:text-on-surface-variant/50"
                  placeholder="Pesquisar por email..."
                  type="text"
                />
              </div>
              <div className="text-xs font-mono text-on-surface-variant/70">
                {totalCount} utilizadores
              </div>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-[#0A0A0A]/50 border-b border-primary/10 font-label-sm text-on-surface-variant uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4 font-medium">Nome</th>
                    <th className="px-6 py-4 font-medium">Email</th>
                    <th className="px-6 py-4 font-medium">Nivel de Acesso</th>
                    <th className="px-6 py-4 font-medium">Estado</th>
                    <th className="px-6 py-4 font-medium">Corridas</th>
                    <th className="px-6 py-4 font-medium">Criado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-primary/5 font-body-sm text-on-surface">
                  {users.map((user) => {
                    const isSuspended = Boolean(user.suspended_until && new Date(user.suspended_until) > new Date());
                    return (
                      <tr key={user.id} className="hover:bg-surface-variant/30 transition-colors cursor-pointer border-l-2 border-transparent hover:border-primary">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-surface-variant border border-outline-variant flex items-center justify-center text-on-surface font-bold text-xs">
                              {(user.full_name || user.email || 'U').substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium">{user.full_name || 'Utilizador Desconhecido'}</div>
                              <div className="text-on-surface-variant/70 text-xs">ID: {user.id.substring(0, 8)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-on-surface-variant">{user.email || '-'}</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2 py-1 rounded text-primary bg-primary/10 border border-primary/20 font-label-sm uppercase tracking-wider">
                            {user.role?.toUpperCase() || 'STANDARD'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2 py-1 rounded border text-[11px] font-bold uppercase tracking-wider ${
                            isSuspended
                              ? 'border-red-400/30 bg-red-400/10 text-red-300'
                              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                          }`}>
                            {isSuspended ? 'Suspenso' : 'Activo'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-on-surface-variant">{user.total_rides}</td>
                        <td className="px-6 py-4 text-on-surface-variant">{new Date(user.created_at).toLocaleDateString('pt-AO')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-primary/10 flex items-center justify-between">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded border border-primary/20 text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <span className="text-xs font-mono text-on-surface-variant/70">
                Pagina {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="px-4 py-2 rounded border border-primary/20 text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Seguinte
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
