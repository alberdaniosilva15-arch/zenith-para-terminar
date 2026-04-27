import { startTransition, useEffect, useState } from 'react';

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function useIdleMount(enabled = true, timeoutMs = 700): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!enabled || mounted || typeof window === 'undefined') return;

    let cancelled = false;
    const idleWindow = window as IdleCapableWindow;

    const commit = () => {
      if (cancelled) return;
      startTransition(() => {
        setMounted(true);
      });
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(() => commit(), { timeout: timeoutMs });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(commit, 48);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [enabled, mounted, timeoutMs]);

  return mounted;
}
