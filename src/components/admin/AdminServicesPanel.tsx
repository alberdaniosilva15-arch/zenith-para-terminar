import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import type { ServiceType } from '../../types';

type ServiceFilter = 'all' | Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;
type StatusFilter = 'all' | 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

interface PremiumBookingRow {
  id: string;
  user_id: string;
  driver_id: string | null;
  service_type: Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;
  status: StatusFilter;
  pickup_address: string | null;
  dest_address: string | null;
  scheduled_at: string | null;
  price_kz: number;
  notify_me: boolean;
  notes: string | null;
  created_at: string;
}

interface DriverOption {
  id: string;
  name: string;
  rating: number;
}

export default function AdminServicesPanel() {
  const [bookings, setBookings] = useState<PremiumBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [driverOptions, setDriverOptions] = useState<DriverOption[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [taxiRevenue, setTaxiRevenue] = useState(0);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from('premium_bookings')
      .select('id, user_id, driver_id, service_type, status, pickup_address, dest_address, scheduled_at, price_kz, notify_me, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(80);

    if (serviceFilter !== 'all') {
      query = query.eq('service_type', serviceFilter);
    }
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const [{ data: bookingRows }, { data: driverDocs }, { data: taxiRows }] = await Promise.all([
      query,
      supabase.from('driver_documents').select('driver_id, profiles:driver_id(name, rating)').eq('status', 'approved'),
      supabase
        .from('rides')
        .select('price_kz')
        .eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const premiumRows = (bookingRows ?? []) as PremiumBookingRow[];
    const ids = Array.from(new Set([
      ...premiumRows.map((booking) => booking.user_id),
      ...premiumRows.map((booking) => booking.driver_id).filter((value): value is string => !!value),
    ]));

    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name')
        .in('user_id', ids);

      const profileMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.name ?? 'Utilizador Zenith']));
      setUserNames(profileMap);
      setDriverNames(profileMap);
    } else {
      setUserNames({});
      setDriverNames({});
    }

    const approvedDrivers = (driverDocs ?? []).map((item: any) => ({
      id: item.driver_id,
      name: item.profiles?.name ?? 'Motorista Zenith',
      rating: Number(item.profiles?.rating ?? 0),
    })) as DriverOption[];

    setBookings(premiumRows);
    setDriverOptions(approvedDrivers);
    setTaxiRevenue((taxiRows ?? []).reduce((sum, row) => sum + Number(row.price_kz ?? 0), 0));
    setLoading(false);
  }, [serviceFilter, statusFilter]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const metrics = useMemo(() => {
    const total = bookings.length;
    const successful = bookings.filter((booking) => ['confirmed', 'in_progress', 'completed'].includes(booking.status)).length;
    const cancelled = bookings.filter((booking) => booking.status === 'cancelled').length;
    const revenueByType = bookings.reduce<Record<string, number>>((acc, booking) => {
      acc[booking.service_type] = (acc[booking.service_type] ?? 0) + Number(booking.price_kz ?? 0);
      return acc;
    }, {});

    return {
      total,
      bookingRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      cancellationRate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
      revenueByType,
      premiumRevenue: bookings.reduce((sum, booking) => sum + Number(booking.price_kz ?? 0), 0),
    };
  }, [bookings]);

  const chartData = useMemo(() => ([
    { name: 'Taxi normal', revenue: taxiRevenue },
    { name: 'Premium', revenue: metrics.premiumRevenue },
  ]), [metrics.premiumRevenue, taxiRevenue]);

  const handleAssignDriver = async (bookingId: string) => {
    const driverId = assignmentDrafts[bookingId];
    if (!driverId) return;

    setUpdating(bookingId);
    await supabase
      .from('premium_bookings')
      .update({
        driver_id: driverId,
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    await loadServices();
    setUpdating(null);
  };

  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Bookings" value={String(metrics.total)} />
        <MetricCard label="Booking rate" value={`${metrics.bookingRate}%`} />
        <MetricCard label="Cancelamentos" value={`${metrics.cancellationRate}%`} />
        <MetricCard label="Receita premium" value={`${Math.round(metrics.premiumRevenue).toLocaleString('pt-AO')} Kz`} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 text-white">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Receita por serviço</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(['private_driver', 'charter', 'cargo'] as Array<Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>>).map((item) => (
              <div key={item} className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/45">{item.replace('_', ' ')}</p>
                <p className="mt-2 text-xl font-black text-primary">
                  {Math.round(metrics.revenueByType[item] ?? 0).toLocaleString('pt-AO')} Kz
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 text-white">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Premium vs taxi normal</p>
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#CBD5E1', fontWeight: 800 }} />
                <Tooltip />
                <Bar dataKey="revenue" radius={[12, 12, 0, 0]} fill="#E6C364" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value as ServiceFilter)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
        >
          <option value="all">Todos os serviços</option>
          <option value="private_driver">Motorista privado</option>
          <option value="charter">Fretamento</option>
          <option value="cargo">Mercadorias</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
        >
          <option value="all">Todos os estados</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center text-sm font-bold text-white/55">
            A carregar reservas premium...
          </div>
        ) : bookings.length === 0 ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center text-sm font-bold text-white/55">
            Ainda não existem reservas premium com estes filtros.
          </div>
        ) : (
          bookings.map((booking) => (
            <div key={booking.id} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-primary/15 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary">
                      {booking.service_type.replace('_', ' ')}
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white/70">
                      {booking.status}
                    </span>
                    {booking.notify_me && (
                      <span className="rounded-full bg-[#E6C364]/15 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-[#E6C364]">
                        Notify me
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 text-lg font-black">{userNames[booking.user_id] ?? 'Cliente Zenith'}</h3>
                  <p className="mt-1 text-[11px] font-bold text-white/55">
                    {booking.pickup_address ?? 'Origem a confirmar'} {'->'} {booking.dest_address ?? 'Destino a confirmar'}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
                    {booking.scheduled_at ? new Date(booking.scheduled_at).toLocaleString('pt-AO') : 'Sem agendamento'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-primary">{Math.round(booking.price_kz).toLocaleString('pt-AO')} Kz</p>
                  <p className="text-[10px] font-bold text-white/45">
                    {driverNames[booking.driver_id ?? ''] ?? 'Sem motorista'}
                  </p>
                </div>
              </div>

              {booking.notes && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[11px] font-bold text-white/70">
                  {booking.notes}
                </div>
              )}

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <select
                  value={assignmentDrafts[booking.id] ?? booking.driver_id ?? ''}
                  onChange={(event) => setAssignmentDrafts((prev) => ({ ...prev, [booking.id]: event.target.value }))}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-bold text-white outline-none"
                >
                  <option value="">Atribuir motorista manualmente</option>
                  {driverOptions.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} · {driver.rating.toFixed(1)}*
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleAssignDriver(booking.id)}
                  disabled={!assignmentDrafts[booking.id] || updating === booking.id || booking.status === 'completed' || booking.status === 'cancelled'}
                  className="rounded-2xl bg-primary px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                >
                  {updating === booking.id ? 'A guardar...' : 'Atribuir'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
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
