import { useEffect } from 'react';

export function useAutoScroll(ref: React.RefObject<HTMLElement>, speed = 0.5) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf: number;
    let dir = 1;
    let isStopped = false;

    const step = () => {
      if (!el || isStopped) return;
      el.scrollLeft += speed * dir;
      // Inverter direção se chegar à ponta
      if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) dir = -1;
      if (el.scrollLeft <= 0) dir = 1;
      
      // Update scrolled class for hint hiding
      const wrapper = el.closest('.zr-scroll-hint');
      if (wrapper) {
        if (el.scrollLeft > 20) {
          wrapper.classList.add('scrolled');
        } else {
          wrapper.classList.remove('scrolled');
        }
      }

      raf = requestAnimationFrame(step);
    };

    // Iniciar após 2s
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(step);
    }, 2000);

    const stop = () => {
      isStopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      const wrapper = el.closest('.zr-scroll-hint');
      if (wrapper && el.scrollLeft > 20) wrapper.classList.add('scrolled');
    };

    el.addEventListener('touchstart', stop, { once: true });
    el.addEventListener('mousedown', stop, { once: true });
    el.addEventListener('scroll', () => {
      const wrapper = el.closest('.zr-scroll-hint');
      if (wrapper) {
        if (el.scrollLeft > 20) wrapper.classList.add('scrolled');
        else wrapper.classList.remove('scrolled');
      }
    }, { passive: true });

    return () => {
      stop();
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('mousedown', stop);
    };
  }, [ref, speed]);
}
