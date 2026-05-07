import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Post } from '../types';
import { UserRole } from '../types';

const ZONES = ['Geral', 'Viana', 'Kilamba', 'Talatona', 'Cazenga', 'Maianga', 'Zango'];

const TIMER_OPTIONS = [
  { label: '1h',  value: 1,  ms: 1 * 60 * 60 * 1000 },
  { label: '6h',  value: 6,  ms: 6 * 60 * 60 * 1000 },
  { label: '12h', value: 12, ms: 12 * 60 * 60 * 1000 },
  { label: '24h', value: 24, ms: 24 * 60 * 60 * 1000 },
];

const SocialFeed: React.FC<{ userId: string; userName: string; role: UserRole }> = ({
  userId, userName, role,
}) => {
  const { profile } = useAuth();
  const [posts,    setPosts]    = useState<Post[]>([]);
  const [newPost,  setNewPost]  = useState('');
  const [zone,     setZone]     = useState('Geral');
  const [postType, setPostType] = useState<'status' | 'alert' | 'event'>('status');
  const [loading,  setLoading]  = useState(true);
  const [posting,  setPosting]  = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [timerHours, setTimerHours] = useState(24);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filterExpired = (postList: Post[]): Post[] => {
    const now = Date.now();
    return postList.filter(p => {
      if (!p.expiresAt) return true;
      return p.expiresAt > now;
    });
  };

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setPosts(prev => filterExpired(prev));
    }, 30_000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from('posts')
        .select('id, user_id, content, post_type, location, likes, created_at, expires_at')
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        if (mounted) setLoading(false);
        return;
      }

      if (!data || !mounted) { setLoading(false); return; }

      const ids = [...new Set(data.map((p: any) => p.user_id))];
      
      let profileRows: any[] = [];
      if (ids.length > 0) {
        const { data: res } = await supabase
          .from('profiles')
          .select('user_id, name, avatar_url, rating')
          .in('user_id', ids);
        profileRows = res ?? [];
      }

      const profileMap: Record<string, { name: string; avatar_url: string | null; rating: number }> = {};
      profileRows.forEach((pr: any) => {
        profileMap[pr.user_id] = { name: pr.name, avatar_url: pr.avatar_url, rating: pr.rating };
      });

      if (mounted) {
        setPosts(
          filterExpired(data.map((p: any) => ({
            id:        p.id,
            userId:    p.user_id,
            userName:  profileMap[p.user_id]?.name ?? 'Utilizador',
            userRole:  userId === p.user_id ? role : UserRole.DRIVER,
            content:   p.content,
            type:      p.post_type ?? 'status',
            location:  p.location,
            likes:     p.likes ?? 0,
            comments:  0,
            timestamp: new Date(p.created_at).getTime(),
            expiresAt: p.expires_at ? new Date(p.expires_at).getTime() : null,
          })))
        );
        setLoading(false);
      }
    };

    load();

    const channelName = `social_feed_user_${userId}`;
    const ch = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
        if (!mounted) return;
        const n = payload.new as any;
        const { data: pr } = await supabase
          .from('profiles')
          .select('name')
          .eq('user_id', n.user_id)
          .maybeSingle();

        const newPost: Post = {
          id:        n.id,
          userId:    n.user_id,
          userName:  pr?.name ?? userName,
          userRole:  userId === n.user_id ? role : UserRole.DRIVER,
          content:   n.content,
          type:      n.post_type ?? 'status',
          location:  n.location,
          likes:     0,
          comments:  0,
          timestamp: new Date(n.created_at).getTime(),
          expiresAt: n.expires_at ? new Date(n.expires_at).getTime() : null,
        };
        setPosts(prev => [newPost, ...prev].slice(0, 50));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        if (!mounted) return;
        const u = payload.new as any;
        setPosts(prev => prev.map(p => p.id === u.id ? { ...p, likes: u.likes ?? p.likes } : p));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
        if (!mounted) return;
        const d = payload.old as any;
        setPosts(prev => prev.filter(p => p.id !== d.id));
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [userId, userName, role]);

  const handlePost = async () => {
    if (!newPost.trim() || posting) return;
    setPosting(true);

    const expiresAt = new Date(Date.now() + timerHours * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from('posts').insert({
      user_id:    userId,
      content:    newPost.trim(),
      post_type:  postType,
      location:   zone !== 'Geral' ? zone : null,
      likes:      0,
      expires_at: expiresAt,
    });

    if (!error) setNewPost('');
    setPosting(false);
  };

  const handleDelete = async (postId: string, postUserId: string) => {
    if (postUserId !== userId) return;
    if (!confirm('Apagar este post?')) return;
    
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    if (!error) {
      setPosts(prev => prev.filter(p => p.id !== postId));
    }
  };

  const handleLike = async (post: Post) => {
    if (likedIds.has(post.id)) return;
    const previousLikes = post.likes ?? 0;
    const optimisticLikes = previousLikes + 1;
    setLikedIds(prev => new Set([...prev, post.id]));
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, likes: optimisticLikes } : p));

    const { data, error } = await supabase.rpc('increment_post_likes', { p_post_id: post.id });
    const nextLikes = Number(data);

    if (error || !Number.isFinite(nextLikes) || nextLikes < 0) {
      setLikedIds(prev => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, likes: previousLikes } : p));
      return;
    }

    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, likes: nextLikes } : p));
  };

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'agora';
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return `${Math.floor(diff / 1440)}d`;
  };

  const timeRemaining = (expiresAt: number | null | undefined) => {
    if (!expiresAt) return null;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'expirado';
    const hours = Math.floor(remaining / 3600000);
    const mins  = Math.floor((remaining % 3600000) / 60000);
    if (hours > 0) return `${hours}h restantes`;
    return `${Math.max(mins, 1)}m restantes`;
  };

  const expiryProgress = (timestamp: number, expiresAt: number | null | undefined) => {
    if (!expiresAt) return null;
    const totalWindow = Math.max(expiresAt - timestamp, 1);
    const remaining = Math.max(0, expiresAt - Date.now());
    const progress = Math.max(6, Math.min(100, Math.round((remaining / totalWindow) * 100)));
    return { progress, urgent: remaining < 3600000 };
  };

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <header className="zr-header">
        <p className="zr-kicker">Comunidade</p>
        <h2 className="zr-section-title">Feed Zenith</h2>
      </header>

      {/* Zones / Filters */}
      <div className="zr-scroll-x" style={{ padding: '0 14px 14px' }}>
        {ZONES.map(z => (
          <button 
            key={z} 
            className={`zr-chip ${zone === z ? 'zr-chip--gold' : 'zr-chip--muted'}`}
            onClick={() => setZone(z)}
          >
            {z}
          </button>
        ))}
      </div>

      {/* Create Post */}
      <section className="zr-card" style={{ marginInline: '14px', marginBottom: '24px' }}>
        <div style={{ marginBottom: '12px' }}>
          {(['status', 'alert', 'event'] as const).map(t => (
            <button 
              key={t} 
              onClick={() => setPostType(t)}
              className={`zr-chip ${postType === t ? (t === 'alert' ? 'zr-chip--danger' : t === 'event' ? 'zr-chip--info' : 'zr-chip--gold') : 'zr-chip--muted'}`}
              style={{ marginRight: '8px' }}
            >
              {t === 'status' ? 'Status' : t === 'alert' ? 'Alerta' : 'Evento'}
            </button>
          ))}
        </div>
        
        <textarea
          value={newPost}
          onChange={e => setNewPost(e.target.value)}
          placeholder="Partilha o que se passa..."
          className="zr-textarea"
          rows={2}
          style={{ width: '100%', marginBottom: '12px' }}
        />

        <div className="zr-inline zr-inline--between">
          <div style={{ position: 'relative' }}>
            <button className="zr-chip zr-chip--muted" onClick={() => setShowTimerPicker(!showTimerPicker)}>
              ⏱ {timerHours}h
            </button>
            {showTimerPicker && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '8px', background: 'var(--surface-3)', borderRadius: '12px', padding: '8px', zIndex: 10, display: 'flex', gap: '4px' }}>
                {TIMER_OPTIONS.map(opt => (
                  <button 
                    key={opt.value}
                    className="zr-button zr-button--sm zr-button--ghost"
                    onClick={() => { setTimerHours(opt.value); setShowTimerPicker(false); }}
                    style={{ minWidth: '40px', padding: '0 8px' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <button 
            onClick={handlePost} 
            disabled={posting || !newPost.trim()}
            className="zr-button zr-button--sm"
          >
            {posting ? 'A enviar...' : 'Publicar'}
          </button>
        </div>
      </section>

      {/* Feed */}
      <div style={{ padding: '0 14px' }}>
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <div className="zr-loading-dots"><span></span><span></span><span></span></div>
          </div>
        ) : posts.length === 0 ? (
          <div className="zr-empty">
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)' }}>forum</span>
            <p>Nenhuma publicação encontrada.</p>
          </div>
        ) : (
          posts.map(post => {
            const expiry = expiryProgress(post.timestamp, post.expiresAt);
            return (
              <div key={post.id} className="zr-card zr-post" style={{ marginBottom: '14px', position: 'relative', overflow: 'hidden' }}>
                {/* Expire bar */}
                {expiry && (
                  <div className="zr-post-bar" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'var(--line)' }}>
                    <div style={{ width: `${expiry.progress}%`, height: '100%', background: expiry.urgent ? 'var(--danger)' : 'var(--gold)' }} />
                  </div>
                )}
                
                <div className="zr-inline zr-inline--between" style={{ marginBottom: '12px', marginTop: expiry ? '8px' : '0' }}>
                  <div className="zr-inline">
                    <div className="zr-avatar" style={{ width: '32px', height: '32px', fontSize: '12px' }}>
                      {(post.userName || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '13px' }}>{post.userName}</strong>
                      <span className="zr-meta">{timeAgo(post.timestamp)} {post.location && `· ${post.location}`}</span>
                    </div>
                  </div>
                  <div>
                    {post.type === 'alert' && <span className="zr-chip zr-chip--danger">Alerta</span>}
                    {post.type === 'event' && <span className="zr-chip zr-chip--info">Evento</span>}
                    {post.type === 'status' && <span className="zr-chip zr-chip--muted">Status</span>}
                  </div>
                </div>

                <p className="zr-copy" style={{ marginBottom: '16px', color: 'var(--text)' }}>
                  {post.content}
                </p>

                <div className="zr-inline" style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', gap: '16px' }}>
                  <button 
                    onClick={() => handleLike(post)} 
                    style={{ background: 'none', border: 'none', color: likedIds.has(post.id) ? 'var(--danger)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: likedIds.has(post.id) ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
                    {post.likes}
                  </button>
                  <button style={{ background: 'none', border: 'none', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chat_bubble</span>
                    {post.comments}
                  </button>
                  
                  {post.userId === userId && (
                    <button 
                      onClick={() => handleDelete(post.id, post.userId)}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                    </button>
                  )}
                  
                  {post.expiresAt && (
                    <span className="zr-meta" style={{ marginLeft: post.userId === userId ? '12px' : 'auto' }}>
                      {timeRemaining(post.expiresAt)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SocialFeed;
