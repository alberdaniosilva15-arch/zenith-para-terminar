import { useEffect, useRef, useCallback } from 'react';
import { useThemeInternal } from '../contexts/ThemeContext';

/**
 * ThemePour — golden liquid transition overlay.
 *
 * Inspired by the reference HTML: a full-screen overlay with an SVG wave
 * (12 drips + feGaussianBlur glow) that sweeps vertically to reveal the
 * new theme underneath.
 *
 * Implementation: single overlay approach (no app duplication).
 *   1. Overlay fills screen with the OLD background colour
 *   2. Theme toggles instantly (hidden under the overlay)
 *   3. Overlay sweeps away with golden wave, revealing new theme
 *   4. Clean up
 *
 * Respects prefers-reduced-motion — instant swap, no animation.
 */
export default function ThemePour() {
  const { theme, _registerPourHandler, _setTheme, _setTransitioning } = useThemeInternal();
  const overlayRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const themeRef = useRef(theme);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // Stable random seed for drips
  const dripSeed = useRef(7);
  const rnd = useCallback(() => {
    dripSeed.current = (dripSeed.current * 16807) % 2147483647;
    return dripSeed.current / 2147483647;
  }, []);

  // Pre-compute drip positions (same as reference HTML)
  const drips = useRef<Array<{ cx: number; w: number; L: number; ph: number; sp: number }>>([]);

  // Initialise drips once
  useEffect(() => {
    dripSeed.current = 7;
    drips.current = Array.from({ length: 12 }, (_, i) => ({
      cx: 22 + i * 63 + (rnd() - 0.5) * 26,
      w: 6 + rnd() * 9,
      L: 30 + rnd() * 130,
      ph: rnd() * 6.3,
      sp: 1.6 + rnd() * 2.2,
    }));
  }, [rnd]);

  const handlePour = useCallback(() => {
    if (busyRef.current) return;

    // Reduced motion: instant swap
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      _setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
      return;
    }

    busyRef.current = true;
    _setTransitioning(true);

    const overlay = overlayRef.current;
    const svg = svgRef.current;
    const glow = glowRef.current;
    if (!overlay || !svg || !glow) {
      _setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
      busyRef.current = false;
      _setTransitioning(false);
      return;
    }

    const currentTheme = themeRef.current;
    const toLight = currentTheme === 'dark';

    // Old background colour for the overlay
    const oldBg = toLight ? '#050505' : '#f1efea';
    const fillPath = svg.querySelector('#pFill') as SVGPathElement | null;
    const strokePath = svg.querySelector('#pStroke') as SVGPathElement | null;
    const rimPath = svg.querySelector('#pRim') as SVGPathElement | null;
    const goldSGrad = svg.querySelector('#goldS') as SVGLinearGradientElement | null;
    const circStroke = svg.querySelectorAll('#cStroke circle');
    const circFill = svg.querySelectorAll('#cFill circle');

    // Set the fill colour to match old bg
    if (fillPath) fillPath.setAttribute('fill', oldBg);
    circFill.forEach((c) => (c as SVGCircleElement).setAttribute('fill', oldBg));

    overlay.style.background = oldBg;
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
    glow.style.visibility = 'visible';
    svg.style.visibility = 'visible';

    const H = window.innerHeight;
    const W = window.innerWidth;
    const dur = 4200;

    // Update SVG viewBox to match window
    svg.setAttribute('viewBox', `0 -60 ${W} 360`);

    // Toggle theme immediately — hidden under the overlay
    _setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

    const t0 = performance.now();
    const ease = (p: number) => {
      const a = p * p;
      const b = a * p;
      return 3 * a - 2 * b;
    };

    const drawFrame = (now: number) => {
      const rawP = (now - t0) / dur;
      const p = Math.min(1, rawP);

      // The overlay slides from top to bottom (toLight) or bottom to top (toDark)
      const from = toLight ? 0 : H;
      const dest = toLight ? H : 0;
      const Y = from + (dest - from) * ease(p);

      // Amplitude envelope
      const amp = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, rawP * 1.4))), 0.48) * (1 - p * 0.15);
      const t = (now - t0) / 1000;

      // Wave computation
      const ds = drips.current;
      const lens = ds.map((d) => d.L * amp * (0.78 + 0.22 * Math.sin(t * d.sp + d.ph)));
      const wv = (x: number) => (7 * Math.sin(x / 68 + t * 2.2) + 4 * Math.sin(x / 21 - t * 3.1)) * Math.max(amp, 0.3);
      const edge = (x: number) => {
        let y = wv(x);
        ds.forEach((d, i) => {
          const k = (x - d.cx) / d.w;
          const len = lens[i] ?? 0;
          y += len * Math.exp(-k * k);
        });
        return y;
      };

      // Build SVG path
      let pathD = '';
      for (let x = -12; x <= W + 12; x += 4) {
        pathD += (x === -12 ? 'M' : 'L') + x + ',' + edge(x).toFixed(1);
      }
      if (strokePath) strokePath.setAttribute('d', pathD);
      if (rimPath) rimPath.setAttribute('d', pathD);
      if (fillPath) {
        fillPath.setAttribute('d', pathD + `L${W + 12},-60L-12,-60Z`);
      }

      // Drip circles
      ds.forEach((d, i) => {
        const len = lens[i] ?? 0;
        const r = d.w * 0.95 * Math.min(1, len / 28);
        const cy = wv(d.cx) + len - r * 0.85;
        const attrs = { cx: String(d.cx), cy: cy.toFixed(1), r: Math.max(0, r).toFixed(1) };
        if (circStroke[i]) {
          (circStroke[i] as SVGCircleElement).setAttribute('cx', attrs.cx);
          (circStroke[i] as SVGCircleElement).setAttribute('cy', attrs.cy);
          (circStroke[i] as SVGCircleElement).setAttribute('r', attrs.r);
        }
        if (circFill[i]) {
          (circFill[i] as SVGCircleElement).setAttribute('cx', attrs.cx);
          (circFill[i] as SVGCircleElement).setAttribute('cy', attrs.cy);
          (circFill[i] as SVGCircleElement).setAttribute('r', attrs.r);
        }
      });

      // Position SVG and glow
      svg.style.top = `${Y - 60}px`;
      glow.style.top = `${Y}px`;
      glow.style.opacity = String(amp);

      // Animate gradient shift
      if (goldSGrad) {
        goldSGrad.setAttribute('gradientTransform', `translate(${((t * 160) % W)} 0)`);
      }

      // Clip the overlay
      if (toLight) {
        overlay.style.clipPath = `inset(0 0 ${Math.max(0, H - Y)}px 0)`;
      } else {
        overlay.style.clipPath = `inset(${Math.max(0, Y)}px 0 0 0)`;
      }

      overlay.style.opacity = String(0.88 + 0.12 * Math.sin(Math.PI * p * 1.1));

      if (p < 1) {
        requestAnimationFrame(drawFrame);
      } else {
        // Animation done — clean up
        overlay.style.visibility = 'hidden';
        overlay.style.clipPath = '';
        glow.style.visibility = 'hidden';
        svg.style.visibility = 'hidden';
        busyRef.current = false;
        _setTransitioning(false);
      }
    };

    requestAnimationFrame(drawFrame);
  }, [_setTheme, _setTransitioning]);

  // Register the pour handler with ThemeContext
  useEffect(() => {
    _registerPourHandler(handlePour);
    return () => _registerPourHandler(null);
  }, [_registerPourHandler, handlePour]);

  // Build 12 drip circles for SVG
  const circles = Array.from({ length: 12 }, (_, i) => <circle key={i} cx="0" cy="0" r="0" />);

  return (
    <>
      {/* Pour overlay — fixed, covers everything */}
      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          pointerEvents: 'none',
          visibility: 'hidden',
          willChange: 'clip-path, opacity',
        }}
        aria-hidden="true"
      />

      {/* Golden glow band */}
      <div
        ref={glowRef}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          height: 220,
          zIndex: 99998,
          pointerEvents: 'none',
          visibility: 'hidden',
          background: 'linear-gradient(180deg, rgba(200,160,50,0.7), rgba(200,160,50,0.25) 40%, transparent)',
        }}
        aria-hidden="true"
      />

      {/* SVG wave */}
      <svg
        ref={svgRef}
        style={{
          position: 'fixed',
          left: 0,
          width: '100%',
          height: 360,
          zIndex: 100000,
          pointerEvents: 'none',
          visibility: 'hidden',
          overflow: 'visible',
        }}
        viewBox="0 -60 740 360"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="goldS" x1="0" y1="0" x2="740" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#b8872a" />
            <stop offset=".25" stopColor="#e6c364" />
            <stop offset=".5" stopColor="#c9a84c" />
            <stop offset=".75" stopColor="#f0d48a" />
            <stop offset="1" stopColor="#b8872a" />
          </linearGradient>
          <filter id="glow" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#glow)">
          <path id="pStroke" fill="none" stroke="url(#goldS)" strokeWidth="7" />
          <g id="cStroke" fill="none" stroke="url(#goldS)" strokeWidth="7">
            {circles}
          </g>
        </g>
        <path id="pFill" fill="#050505" />
        <g id="cFill" fill="#050505">
          {circles.map((_, i) => <circle key={`f${i}`} cx="0" cy="0" r="0" />)}
        </g>
        <path id="pRim" fill="none" stroke="#f0d48a" strokeWidth="1.8" opacity="0.85" />
      </svg>
    </>
  );
}
