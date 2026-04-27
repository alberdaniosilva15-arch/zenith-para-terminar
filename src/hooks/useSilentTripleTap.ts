import { useEffect, useRef } from 'react';

interface UseSilentTripleTapOptions {
  enabled: boolean;
  onTrigger: () => void;
  windowMs?: number;
  cooldownMs?: number;
}

export function useSilentTripleTap({
  enabled,
  onTrigger,
  windowMs = 1500,
  cooldownMs = 3000,
}: UseSilentTripleTapOptions) {
  const tapsRef = useRef<number[]>([]);
  const cooldownRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      tapsRef.current = [];
      return;
    }

    const handlePointerDown = () => {
      const now = Date.now();
      if (now < cooldownRef.current) {
        return;
      }

      const recentTaps = [...tapsRef.current, now].filter((ts) => now - ts <= windowMs);
      tapsRef.current = recentTaps;

      if (recentTaps.length >= 3) {
        tapsRef.current = [];
        cooldownRef.current = now + cooldownMs;
        onTrigger();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [cooldownMs, enabled, onTrigger, windowMs]);
}
