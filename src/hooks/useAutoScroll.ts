import { useEffect } from 'react';

export function useAutoScroll(ref: React.RefObject<HTMLElement>, speed = 0.5) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respeitar preferência de movimento reduzido (acessibilidade)
    if (typeof window !== 'undefined' && window.matchMedia) {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) return;
    }

    // Forçar scroll-behavior auto para não brigar com animações frame-a-frame de RAF
    const prevScrollBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';

    let raf: number;
    let dir = 1;
    let isPaused = false;
    let isVisible = true;
    let currentPos = el.scrollLeft;
    let resumeTimeout: ReturnType<typeof setTimeout> | null = null;

    const step = () => {
      if (!el) return;

      if (!isPaused && isVisible) {
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (maxScroll > 0) {
          currentPos += speed * dir;

          // Inverter suavemente nas pontas
          if (currentPos >= maxScroll - 1) {
            currentPos = maxScroll - 1;
            dir = -1;
          } else if (currentPos <= 0) {
            currentPos = 0;
            dir = 1;
          }

          el.scrollLeft = Math.round(currentPos);

          // Atualizar classe de hint visual
          const wrapper = el.closest('.zr-scroll-hint');
          if (wrapper) {
            if (el.scrollLeft > 20) {
              wrapper.classList.add('scrolled');
            } else {
              wrapper.classList.remove('scrolled');
            }
          }
        }
      }

      raf = requestAnimationFrame(step);
    };

    // Pausa temporária durante interação com retoma após 4 segundos
    const pauseTemporary = () => {
      isPaused = true;
      if (resumeTimeout) clearTimeout(resumeTimeout);
      resumeTimeout = setTimeout(() => {
        isPaused = false;
        currentPos = el.scrollLeft;
      }, 4000);
    };

    const handlePointerDown = () => {
      isPaused = true;
      if (resumeTimeout) clearTimeout(resumeTimeout);
      currentPos = el.scrollLeft;
    };

    const handlePointerUp = () => {
      currentPos = el.scrollLeft;
      if (resumeTimeout) clearTimeout(resumeTimeout);
      resumeTimeout = setTimeout(() => {
        isPaused = false;
        currentPos = el.scrollLeft;
      }, 4000);
    };

    const handleScroll = () => {
      // Se o scroll físico divergiu do frame calculado, sincronizar e pausar temporariamente
      if (Math.abs(el.scrollLeft - currentPos) > 2) {
        currentPos = el.scrollLeft;
        pauseTemporary();
      }
      const wrapper = el.closest('.zr-scroll-hint');
      if (wrapper) {
        if (el.scrollLeft > 20) wrapper.classList.add('scrolled');
        else wrapper.classList.remove('scrolled');
      }
    };

    el.addEventListener('touchstart', handlePointerDown, { passive: true });
    el.addEventListener('touchend', handlePointerUp, { passive: true });
    el.addEventListener('mousedown', handlePointerDown);
    el.addEventListener('mouseup', handlePointerUp);
    el.addEventListener('scroll', handleScroll, { passive: true });

    // IntersectionObserver com margem ampla para activar antes mesmo de entrar totalmente no ecrã
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          isVisible = entry.isIntersecting;
          if (isVisible) {
            currentPos = el.scrollLeft;
          }
        }
      }, { rootMargin: '100px 0px 100px 0px', threshold: 0 });
      observer.observe(el);
    }

    // Iniciar loop após 1.5s
    const initialTimer = setTimeout(() => {
      currentPos = el.scrollLeft;
      raf = requestAnimationFrame(step);
    }, 1500);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(initialTimer);
      if (resumeTimeout) clearTimeout(resumeTimeout);
      if (observer) observer.disconnect();
      el.removeEventListener('touchstart', handlePointerDown);
      el.removeEventListener('touchend', handlePointerUp);
      el.removeEventListener('mousedown', handlePointerDown);
      el.removeEventListener('mouseup', handlePointerUp);
      el.removeEventListener('scroll', handleScroll);
      el.style.scrollBehavior = prevScrollBehavior;
    };
  }, [ref, speed]);
}
