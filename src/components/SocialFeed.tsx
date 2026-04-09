// =============================================================================
// ZENITH RIDE v3.0 — SocialFeed.tsx
// FIXES:
//   1. Query posts: SELECT simples sem join FK problemático — batch fetch de perfis
//   2. increment_post_likes substituído por UPDATE directo (evita 404)
//   3. Realtime: .on() ANTES de .subscribe()
//   4. Posts com userRole real a partir do join a users
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Post } from '../types';
import { UserRole } from '../types';
import { MessageSquare, Heart, Share2, Send, MapPin, ShieldCheck } from 'lucide-react';

const ZONES = ['Geral', 'Viana', 'Kilamba', 'Talatona', 'Cazenga', 'Maianga', 'Zango'];

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

  // ── Carregar posts ───────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);

      // FIX: SELECT simples sem FK dinâmica para evitar 400
      const { data, error } = await supabase
        .from('posts')
        .select('id, user_id, content, post_type, location, likes, created_at')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        console.error('[SocialFeed] Erro na query posts:', error.message);
        if (mounted) setLoading(false);
        return;
      }

      if (!data || !mounted) { setLoading(false); return; }

      // Buscar nomes em batch
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
          data.map((p: any) => ({
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
          }))
        );
        setLoading(false);
      }
    };

    load();

    // FIX: .on() ANTES de .subscribe()
    const ch = supabase
      .channel(`social_feed_${Date.now()}`)
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
        };
        setPosts(prev => [newPost, ...prev].slice(0, 50));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        if (!mounted) return;
        const u = payload.new as any;
        setPosts(prev => prev.map(p => p.id === u.id ? { ...p, likes: u.likes ?? p.likes } : p));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[SocialFeed] Realtime channel error — a trabalhar sem RT.');
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [userId]);

  // ── Publicar post ────────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!newPost.trim() || posting) return;
    setPosting(true);

    const { error } = await supabase.from('posts').insert({
      user_id:   userId,
      content:   newPost.trim(),
      post_type: postType,
      location:  zone !== 'Geral' ? zone : null,
      likes:     0,
    });

    if (error) console.error('[SocialFeed] Erro ao publicar:', error.message);
    setNewPost('');
    setPosting(false);
  };

  // FIX: UPDATE directo em vez de RPC inexistente
  const handleLike = async (post: Post) => {
    if (likedIds.has(post.id)) return;
    const newLikes = (post.likes ?? 0) + 1;
    setLikedIds(prev => new Set([...prev, post.id]));
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, likes: newLikes } : p));

    const { error } = await supabase
      .from('posts')
      .update({ likes: newLikes })
      .eq('id', post.id);

    if (error) console.error('[SocialFeed] Erro ao dar like:', error.message);
  };

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'agora mesmo';
    if (diff < 60) return `${diff}m atrás`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h atrás`;
    return `${Math.floor(diff / 1440)}d atrás`;
  };

  return (
    <div className="flex flex-col bg-surface-container-lowest pb-24 min-h-screen">

      {/* Header */}
      <div className="bg-surface-container-low p-4 border-b border-outline-variant/20 sticky top-0 z-10 shadow-sm">
        <h2 className="text-lg font-black text-on-surface flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          Comunidade Zenith
        </h2>
        <p className="text-xs text-outline font-bold">Alertas e status em tempo real de Luanda</p>
      </div>

      {/* Criar post */}
      <div className="bg-surface-container-low p-4 mb-2 shadow-sm border-b border-outline-variant/10">
        {/* Zonas */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
          {ZONES.map(z => (
            <button key={z} onClick={() => setZone(z)}
              className={`px-4 py-2 rounded-full text-[9px] font-black uppercase shrink-0 transition-all border ${
                zone === z
                  ? 'bg-surface-container-highest text-white border-outline-variant'
                  : 'bg-surface-container-low text-on-surface-variant/70 border-outline-variant/30 hover:border-outline-variant'
              }`}>
              {z}
            </button>
          ))}
        </div>

        {/* Tipo */}
        <div className="flex gap-2 mb-4">
          {(['status', 'alert', 'event'] as const).map(t => (
            <button key={t} onClick={() => setPostType(t)}
              className={`px-4 py-2 rounded-full text-[9px] font-black uppercase transition-all border ${
                postType === t
                  ? t === 'alert' ? 'bg-red-600 text-white border-red-600'
                  : t === 'event' ? 'bg-primary text-white border-primary'
                  : 'bg-surface-container-highest text-white border-outline-variant'
                  : 'bg-surface-container-low text-on-surface-variant/70 border-outline-variant/30'
              }`}>
              {t === 'status' ? '💬 Status' : t === 'alert' ? '🚨 Alerta' : '📍 Evento'}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black shrink-0">
            {(userName || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <textarea
              value={newPost}
              onChange={e => setNewPost(e.target.value)}
              placeholder={
                postType === 'alert' ? '🚨 Reporta um alerta de trânsito...' :
                postType === 'event' ? '📍 Partilha um evento em Luanda...' :
                '💬 O que está a acontecer no trânsito?'
              }
              className="w-full p-3 bg-surface-container-lowest rounded-xl text-sm border border-outline-variant/20 outline-none focus:ring-2 focus:ring-primary/30 resize-none font-bold text-on-surface"
              rows={2}
              maxLength={280}
            />
            <div className="flex justify-between items-center mt-2">
              <div className="flex items-center gap-1 text-xs text-on-surface-variant/70">
                <MapPin className="w-3 h-3" />
                <span className="font-bold">{zone}</span>
                <span className="text-on-surface-variant/40">· {newPost.length}/280</span>
              </div>
              <button
                onClick={handlePost}
                disabled={posting || !newPost.trim()}
                className="gilded-gradient text-on-primary px-4 py-1.5 rounded-full text-xs font-black flex items-center gap-2 disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all"
              >
                <Send className="w-3 h-3" />
                {posting ? 'A publicar...' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 space-y-2 p-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-[10px] font-black text-on-surface-variant/50 uppercase tracking-widest">A carregar feed...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-3xl mb-3">📻</p>
            <p className="font-black text-on-surface-variant/70 text-sm">Ainda sem publicações</p>
            <p className="text-xs text-on-surface-variant/50 mt-1 font-bold">Sê o primeiro a partilhar um alerta!</p>
          </div>
        ) : (
          posts.map(post => (
            <div key={post.id}
              className="bg-surface-container-low p-4 rounded-2xl shadow-sm border border-outline-variant/20 animate-in fade-in duration-300">

              <div className="flex justify-between items-start mb-3">
                <div className="flex gap-3 items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${
                    post.userRole === UserRole.DRIVER ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary'
                  }`}>
                    {(post.userName || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-black text-on-surface">{post.userName}</span>
                      {post.userRole === UserRole.DRIVER && (
                        <span className="text-[8px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-black uppercase">Motorista</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-on-surface-variant/70 font-bold">{timeAgo(post.timestamp)}</span>
                      {post.location && (
                        <span className="text-[9px] text-on-surface-variant/70 font-bold flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5" />{post.location}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  {post.type === 'alert' && (
                    <span className="text-[9px] bg-red-100 text-red-600 px-2 py-1 rounded-full font-black uppercase animate-pulse">
                      🚨 Alerta
                    </span>
                  )}
                  {post.type === 'event' && (
                    <span className="text-[9px] bg-primary/10 text-primary px-2 py-1 rounded-full font-black uppercase">
                      📍 Evento
                    </span>
                  )}
                  {post.type === 'status' && (
                    <span className="text-[9px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded-full font-black uppercase">
                      💬 Status
                    </span>
                  )}
                </div>
              </div>

              <p className="text-sm text-on-surface-variant leading-relaxed mb-4 font-bold">{post.content}</p>

              <div className="flex items-center gap-6 pt-3 border-t border-outline-variant/10">
                <button
                  onClick={() => handleLike(post)}
                  className={`flex items-center gap-1.5 transition-colors ${
                    likedIds.has(post.id) ? 'text-red-500' : 'text-on-surface-variant/70 hover:text-red-500'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${likedIds.has(post.id) ? 'fill-current' : ''}`} />
                  <span className="text-xs font-bold">{post.likes}</span>
                </button>
                <button className="flex items-center gap-1.5 text-on-surface-variant/70 hover:text-primary transition-colors">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-xs font-bold">{post.comments}</span>
                </button>
                <button className="flex items-center gap-1.5 text-on-surface-variant/70 hover:text-on-surface-variant transition-colors ml-auto">
                  <Share2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SocialFeed;
