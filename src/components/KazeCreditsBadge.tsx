import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

interface KazeCreditsBadgeProps {
  userId: string;
  rideId?: string;
  className?: string;
}

const MAX_CHAT_MESSAGES = 10;

export default function KazeCreditsBadge({ userId, rideId, className = '' }: KazeCreditsBadgeProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    const loadQuota = async () => {
      const { data, error } = await supabase
        .from('kaze_chat_quota_live')
        .select('chat_quota')
        .eq('user_id', userId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        const fallback = await supabase
          .from('profiles')
          .select('chat_quota')
          .eq('user_id', userId)
          .maybeSingle();

        if (!active) return;
        if (fallback.error) {
          console.warn('[KazeCreditsBadge]', fallback.error.message);
          setRemaining(MAX_CHAT_MESSAGES);
          return;
        }

        setRemaining(Number(fallback.data?.chat_quota ?? MAX_CHAT_MESSAGES));
        return;
      }

      setRemaining(Number(data?.chat_quota ?? MAX_CHAT_MESSAGES));
    };

    void loadQuota();

    const channel = supabase
      .channel(`kaze-quota:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'kaze_chat_quota_live', filter: `user_id=eq.${userId}` },
        (payload) => {
          const nextQuota = Number((payload.new as { chat_quota?: number | null } | null)?.chat_quota ?? MAX_CHAT_MESSAGES);
          if (Number.isFinite(nextQuota)) {
            setRemaining(nextQuota);
          } else {
            void loadQuota();
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const visualRemaining = Math.max(0, Math.min(remaining ?? MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGES));

  const palette = useMemo(() => {
    if (visualRemaining <= 2) {
      return 'bg-red-500/15 text-red-300 border-red-500/35';
    }
    if (visualRemaining <= 5) {
      return 'bg-amber-500/15 text-amber-200 border-amber-500/35';
    }
    return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30';
  }, [visualRemaining]);

  return (
    <>
      <style>{`
        @keyframes zenith-kaze-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-1.5px) rotate(-1deg); }
          75% { transform: translateX(1.5px) rotate(1deg); }
        }
      `}</style>
      <div
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${palette} ${className}`.trim()}
        style={visualRemaining <= 2 ? { animation: 'zenith-kaze-shake 0.45s linear infinite' } : undefined}
      >
        <span>🤖</span>
        <span>{visualRemaining}/{MAX_CHAT_MESSAGES} msgs</span>
      </div>
    </>
  );
}
