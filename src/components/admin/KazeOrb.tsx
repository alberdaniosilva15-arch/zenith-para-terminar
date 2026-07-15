import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface KazeAudioStats {
  rawVolume: number;
  rawBass: number;
  rawMid: number;
  rawHigh: number;
  gatedVolume: number;
  gatedBass: number;
  gatedMid: number;
  gatedHigh: number;
  noiseFloor: number;
  frequencyHz: number | null;
  fft: number;
  frequencyBins: number[];
}

interface KazeOrbProps {
  isListening: boolean;
  isSpeaking: boolean;
  volume: number;
  modeLabel?: string;
  onlineStatus?: string;
  audioStats?: KazeAudioStats;
  systemStatus?: {
    activeRides?: number;
    driversOnline?: number;
    fps?: number;
  };
}

const PARTICLE_COUNT = 400;
const DOT_COUNT = 180;
const DEFAULT_AUDIO: KazeAudioStats = {
  rawVolume: 0,
  rawBass: 0,
  rawMid: 0,
  rawHigh: 0,
  gatedVolume: 0,
  gatedBass: 0,
  gatedMid: 0,
  gatedHigh: 0,
  noiseFloor: 0.06,
  frequencyHz: null,
  fft: 0,
  frequencyBins: [],
};

export default function KazeOrb({
  isListening,
  isSpeaking,
  volume,
  modeLabel,
  onlineStatus = 'ONLINE',
  audioStats = DEFAULT_AUDIO,
  systemStatus,
}: KazeOrbProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const freqCanvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ isListening, isSpeaking, volume, audioStats });
  const [fpsValue, setFpsValue] = useState(0);
  const [coords, setCoords] = useState({ lat: '-8.8368', lon: '13.2343' });
  const [webGLError, setWebGLError] = useState(false);

  useEffect(() => {
    propsRef.current = { isListening, isSpeaking, volume, audioStats };
  }, [isListening, isSpeaking, volume, audioStats]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      console.warn('[KazeOrb] WebGL falhou (Brave Shields?):', err);
      setWebGLError(true);
      return undefined;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);
    camera.position.set(0, 0, 4.5);

    const cCyan = new THREE.Color(0x00d4ff);
    const cBlue = new THREE.Color(0x0066ff);
    const cTeal = new THREE.Color(0x00ffcc);

    const sphereGeo = new THREE.IcosahedronGeometry(1, 5);
    const posAttr = sphereGeo.attributes.position as THREE.BufferAttribute;
    const origPos = new Float32Array(posAttr.array as Float32Array);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);

    const innerGeo = new THREE.IcosahedronGeometry(0.88, 4);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x003355,
      transparent: true,
      opacity: 0.4,
    });
    const innerSphere = new THREE.Mesh(innerGeo, innerMat);
    scene.add(innerSphere);

    const makeGlowSphere = (radius: number, opacity: number) => {
      const geometry = new THREE.SphereGeometry(radius, 32, 32);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00aaff,
        transparent: true,
        opacity,
        side: THREE.BackSide,
      });
      return new THREE.Mesh(geometry, material);
    };

    const glow1 = makeGlowSphere(1.15, 0.06);
    const glow2 = makeGlowSphere(1.35, 0.03);
    const glow3 = makeGlowSphere(1.6, 0.015);
    scene.add(glow1, glow2, glow3);

    const dotGeo = new THREE.BufferGeometry();
    const dotPos = new Float32Array(DOT_COUNT * 3);
    for (let i = 0; i < DOT_COUNT; i += 1) {
      const phi = Math.acos(-1 + (2 * i) / DOT_COUNT);
      const theta = Math.sqrt(DOT_COUNT * Math.PI) * phi;
      dotPos[i * 3] = Math.sin(phi) * Math.cos(theta);
      dotPos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
      dotPos[i * 3 + 2] = Math.cos(phi);
    }
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    const dotMat = new THREE.PointsMaterial({
      color: 0x00ffcc,
      size: 0.025,
      transparent: true,
      opacity: 0.7,
    });
    const dots = new THREE.Points(dotGeo, dotMat);
    scene.add(dots);

    const ptclGeo = new THREE.BufferGeometry();
    const ptclPos = new Float32Array(PARTICLE_COUNT * 3);
    const ptclOrig = new Float32Array(PARTICLE_COUNT * 3);
    const ptclSeed = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const radius = 1.8 + Math.random() * 1.2;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI * 2;
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      ptclOrig[i * 3] = x;
      ptclOrig[i * 3 + 1] = y;
      ptclOrig[i * 3 + 2] = z;
      ptclPos[i * 3] = x;
      ptclPos[i * 3 + 1] = y;
      ptclPos[i * 3 + 2] = z;
      ptclSeed[i] = Math.random() * Math.PI * 2;
    }
    ptclGeo.setAttribute('position', new THREE.BufferAttribute(ptclPos, 3));
    const ptclMat = new THREE.PointsMaterial({
      color: 0x00d4ff,
      size: 0.018,
      transparent: true,
      opacity: 0.6,
    });
    const ptclMesh = new THREE.Points(ptclGeo, ptclMat);
    scene.add(ptclMesh);

    const makeRing = (radius: number, tube: number, color: number, opacity: number) => {
      const geometry = new THREE.TorusGeometry(radius, tube, 2, 128);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
      return new THREE.Mesh(geometry, material);
    };

    const ring1 = makeRing(1.5, 0.006, 0x00d4ff, 0.55);
    const ring2 = makeRing(1.72, 0.005, 0x0088ff, 0.4);
    const ring3 = makeRing(1.95, 0.004, 0x00ffcc, 0.28);
    ring1.rotation.x = Math.PI / 2;
    ring2.rotation.x = Math.PI / 3;
    ring2.rotation.z = Math.PI / 6;
    ring3.rotation.x = Math.PI / 4;
    ring3.rotation.y = Math.PI / 5;
    scene.add(ring1, ring2, ring3);

    const clock = new THREE.Clock();
    let animationId = 0;
    let frameCount = 0;
    let fpsTime = 0;
    let mouseX = 0;
    let mouseY = 0;
    let smoothVolume = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothHigh = 0;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const drawFreq = (bins: number[]) => {
      // Disabled frequency canvas to prevent visual obstruction
    };

    const animate = () => {
      animationId = window.requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      const current = propsRef.current;
      const stats = current.audioStats || DEFAULT_AUDIO;
      const bins = stats.frequencyBins || [];

      const idleVolume = Math.sin(elapsed * 0.8) * 0.04 + 0.03;
      const targetVolume = current.isListening || current.isSpeaking
        ? Math.max(stats.gatedVolume || current.volume || 0, current.isSpeaking ? 0.18 : 0.05)
        : idleVolume;
      const targetBass = current.isListening || current.isSpeaking ? stats.gatedBass || targetVolume * 0.8 : Math.sin(elapsed * 0.5) * 0.02 + 0.01;
      const targetMid = current.isListening || current.isSpeaking ? stats.gatedMid || targetVolume * 0.55 : Math.sin(elapsed * 1.1) * 0.01 + 0.005;
      const targetHigh = current.isListening || current.isSpeaking ? stats.gatedHigh || targetVolume * 0.35 : 0;
      const lerpSpeed = 0.08 * 60 * delta;

      smoothVolume += (targetVolume - smoothVolume) * lerpSpeed;
      smoothBass += (targetBass - smoothBass) * lerpSpeed;
      smoothMid += (targetMid - smoothMid) * lerpSpeed;
      smoothHigh += (targetHigh - smoothHigh) * lerpSpeed;

      frameCount += 1;
      fpsTime += delta;
      if (fpsTime >= 0.5) {
        setFpsValue(Math.round(frameCount / fpsTime));
        setCoords({
          lat: (-8.8368 + Math.sin(elapsed * 0.05) * 0.0001).toFixed(4),
          lon: (13.2343 + Math.cos(elapsed * 0.07) * 0.0001).toFixed(4),
        });
        frameCount = 0;
        fpsTime = 0;
      }

      for (let i = 0; i < posAttr.count; i += 1) {
        const ix = i * 3;
        const ox = origPos[ix] ?? 0;
        const oy = origPos[ix + 1] ?? 0;
        const oz = origPos[ix + 2] ?? 0;
        const audioValue = bins.length ? (bins[i % bins.length] || 0) / 256 : 0;
        const wave = Math.sin(elapsed * 1.5 + i * 0.3) * 0.04;
        const deform = wave + audioValue * smoothBass * 0.6 + smoothMid * 0.2;
        const scale = 1 + deform;
        posAttr.setXYZ(i, ox * scale, oy * scale, oz * scale);
      }
      posAttr.needsUpdate = true;

      const rotationSpeed = 0.003 + smoothBass * 0.05;
      sphere.rotation.y += rotationSpeed;
      sphere.rotation.x += rotationSpeed * 0.4;
      innerSphere.rotation.y -= 0.002;
      innerSphere.rotation.z += 0.001;
      dots.rotation.y += 0.004 + smoothMid * 0.02;
      dots.rotation.x -= 0.001;

      const sphereScale = 1 + smoothBass * 0.35 + smoothVolume * 0.15;
      sphere.scale.lerp(new THREE.Vector3(sphereScale, sphereScale, sphereScale), 6 * delta);
      const glowIntensity = 1 + smoothVolume * 0.4 + (current.isSpeaking ? 0.18 : 0);
      glow1.scale.set(glowIntensity, glowIntensity, glowIntensity);
      glow2.scale.set(glowIntensity * 0.95, glowIntensity * 0.95, glowIntensity * 0.95);
      glow3.scale.set(glowIntensity * 0.9, glowIntensity * 0.9, glowIntensity * 0.9);
      (glow1.material as THREE.MeshBasicMaterial).opacity = 0.06 + smoothVolume * 0.12 + (current.isSpeaking ? 0.05 : 0);
      (glow2.material as THREE.MeshBasicMaterial).opacity = 0.03 + smoothVolume * 0.07;

      ring1.rotation.z += 0.006 + smoothMid * 0.08 + (current.isListening ? 0.018 : 0);
      ring2.rotation.y += 0.004 + smoothBass * 0.06 + (current.isListening ? 0.014 : 0);
      ring3.rotation.x += 0.005 + smoothHigh * 0.1 + (current.isSpeaking ? 0.02 : 0);
      ring3.rotation.z -= 0.003;
      (ring1.material as THREE.MeshBasicMaterial).opacity = 0.55 + smoothVolume * 0.35;
      (ring2.material as THREE.MeshBasicMaterial).opacity = 0.4 + smoothMid * 0.35;
      (ring3.material as THREE.MeshBasicMaterial).opacity = 0.28 + smoothHigh * 0.4;

      const particleAttr = ptclGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const ix = i * 3;
        const ox = ptclOrig[ix] ?? 0;
        const oy = ptclOrig[ix + 1] ?? 0;
        const oz = ptclOrig[ix + 2] ?? 0;
        const magnitude = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        const scatter = 1 + smoothVolume * 1.2 + smoothBass * 0.8;
        const orbit = elapsed * (0.12 + (i % 7) * 0.02) + (ptclSeed[i] ?? 0);
        const wobble = Math.sin(orbit) * 0.08 * smoothVolume;
        particleAttr.setXYZ(
          i,
          (ox / magnitude) * magnitude * scatter + Math.sin(orbit + ix) * wobble,
          (oy / magnitude) * magnitude * scatter + Math.cos(orbit + ix + 1) * wobble,
          (oz / magnitude) * magnitude * scatter + Math.sin(orbit * 1.3) * wobble,
        );
      }
      particleAttr.needsUpdate = true;

      ptclMat.color.lerpColors(cCyan, cTeal, Math.min(smoothVolume * 2, 1));
      dotMat.color.lerpColors(cTeal, cBlue, Math.min(smoothBass * 2, 1));
      sphereMat.color.lerpColors(cCyan, cTeal, current.isSpeaking ? 0.85 : Math.min(smoothVolume * 1.2, 0.5));

      camera.position.x += (mouseX * 0.3 - camera.position.x) * 0.05;
      camera.position.y += (-mouseY * 0.3 - camera.position.y) * 0.05;
      camera.lookAt(0, 0, 0);

      drawFreq(bins);
      renderer.render(scene, camera);
    };

    const onPointerMove = (event: PointerEvent) => {
      mouseX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      mouseY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove);
    resize();
    animate();

    return () => {
      window.cancelAnimationFrame(animationId);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      scene.traverse((object: THREE.Object3D) => {
        const mesh = object as THREE.Mesh;
        const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        geometry?.dispose();
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    };
  }, []);

  const mode = modeLabel || (isSpeaking ? 'SPEAKING' : isListening ? 'LISTENING' : 'IDLE');
  const audioMode = isSpeaking ? 'SPEAKING' : isListening ? 'ACTIVE' : 'STANDBY';
  const displayedVolume = Math.min(100, Math.max(0, (audioStats.rawVolume || volume || 0) * 150));
  const thresholdLeft = Math.min((audioStats.noiseFloor || 0.06) * 150, 95);
  const fps = systemStatus?.fps ?? fpsValue;

  return (
    <div className="kaze-orb-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap');

        .kaze-orb-root {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #000;
          color: #00d4ff;
          font-family: "Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          cursor: crosshair;
        }
        .kaze-orb-canvas {
          position: absolute;
          inset: 0;
          z-index: 0;
        }
        .kaze-orb-root canvas {
          display: block;
          width: 100% !important;
          height: 100% !important;
        }
        .kaze-orb-hud,
        .kaze-orb-scanlines,
        .kaze-orb-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .kaze-orb-hud { z-index: 10; }
        .kaze-orb-scanlines {
          z-index: 5;
          background: repeating-linear-gradient(
            to bottom,
            transparent 0px,
            transparent 3px,
            rgba(0,0,0,0.08) 3px,
            rgba(0,0,0,0.08) 4px
          );
        }
        .kaze-orb-vignette {
          z-index: 4;
          background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%);
        }
        .kaze-orb-corner {
          position: absolute;
          width: 60px;
          height: 60px;
        }
        .kaze-orb-corner::before,
        .kaze-orb-corner::after {
          content: "";
          position: absolute;
          background: #00d4ff;
          opacity: 0.5;
        }
        .kaze-orb-corner::before { width: 2px; height: 30px; }
        .kaze-orb-corner::after { width: 30px; height: 2px; }
        .kaze-orb-corner.tl { top: 24px; left: 24px; }
        .kaze-orb-corner.tr { top: 24px; right: 24px; }
        .kaze-orb-corner.bl { bottom: 24px; left: 24px; }
        .kaze-orb-corner.br { bottom: 24px; right: 24px; }
        .kaze-orb-corner.tl::before,
        .kaze-orb-corner.tl::after { top: 0; left: 0; }
        .kaze-orb-corner.tr::before,
        .kaze-orb-corner.tr::after { top: 0; right: 0; }
        .kaze-orb-corner.bl::before,
        .kaze-orb-corner.bl::after { bottom: 0; left: 0; }
        .kaze-orb-corner.br::before,
        .kaze-orb-corner.br::after { bottom: 0; right: 0; }
        .kaze-orb-panel {
          position: absolute;
          font-size: 10px;
          letter-spacing: 0.15em;
          line-height: 1.9;
          opacity: 0.5;
          color: #00d4ff;
          text-transform: uppercase;
          animation: kaze-orb-flicker 8s infinite;
        }
        .kaze-orb-panel.top-left { top: 44px; left: 44px; }
        .kaze-orb-panel.top-right { top: 44px; right: 44px; text-align: right; }
        .kaze-orb-panel.bot-left { bottom: 44px; left: 44px; }
        .kaze-orb-panel.bot-right { bottom: 44px; right: 44px; text-align: right; }
        .kaze-orb-status {
          position: absolute;
          bottom: 50%;
          left: 50%;
          transform: translate(-50%, 140px);
          text-align: center;
          pointer-events: none;
        }
        .kaze-orb-status-text {
          font-family: Orbitron, "Share Tech Mono", monospace;
          font-size: 11px;
          letter-spacing: 0.5em;
          color: #00d4ff;
          opacity: 0.6;
          text-transform: uppercase;
        }
        .kaze-orb-vol-wrap {
          margin-top: 10px;
          width: 160px;
          height: 2px;
          background: rgba(0,212,255,0.1);
          border: 1px solid rgba(0,212,255,0.2);
          overflow: visible;
          position: relative;
        }
        .kaze-orb-vol-bar {
          height: 100%;
          background: #00d4ff;
          box-shadow: 0 0 8px #00d4ff;
          transition: width 0.05s ease;
        }
        .kaze-orb-threshold {
          position: absolute;
          top: -4px;
          width: 1px;
          height: 10px;
          background: #ff6600;
          box-shadow: 0 0 6px #ff6600;
          transition: left 0.4s ease;
        }
        .kaze-orb-threshold::after {
          content: "GATE";
          position: absolute;
          top: 12px;
          left: -10px;
          font-size: 8px;
          color: #ff6600;
          letter-spacing: 0.1em;
          white-space: nowrap;
        }
        .kaze-orb-freq-canvas {
          display: none;
        }
        .kaze-orb-dot {
          display: inline-block;
          animation: kaze-orb-pulse-dot 1.2s infinite;
        }
        @keyframes kaze-orb-flicker {
          0%, 95%, 100% { opacity: 0.5; }
          96% { opacity: 0.2; }
          98% { opacity: 0.5; }
        }
        @keyframes kaze-orb-pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .kaze-orb-fallback {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }
        .kaze-orb-fallback-circle {
          width: 250px;
          height: 250px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(0,212,255,0.1) 0%, rgba(0,51,85,0.3) 60%, transparent 80%);
          border: 1px dashed rgba(0,212,255,0.2);
          box-shadow: 0 0 50px rgba(0,212,255,0.1);
          animation: kaze-orb-flicker 4s infinite ease-in-out;
          transition: transform 0.1s ease-out;
        }
        .kaze-orb-fallback-text {
          position: absolute;
          font-size: 10px;
          color: #00d4ff;
          text-align: center;
          opacity: 0.4;
          margin-top: 280px;
        }
      `}</style>

      {webGLError ? (
        <div className="kaze-orb-fallback">
          <div className="kaze-orb-fallback-circle" style={{ transform: `scale(${1 + (audioStats.rawVolume || volume || 0) * 0.5})` }} />
          <div className="kaze-orb-fallback-text">WebGL BLOQUEADO<br/>(Desativa Brave Shields)</div>
        </div>
      ) : (
        <div ref={mountRef} className="kaze-orb-canvas" />
      )}
      <div className="kaze-orb-scanlines" />
      <div className="kaze-orb-vignette" />
      <div className="kaze-orb-hud">
        <div className="kaze-orb-corner tl" />
        <div className="kaze-orb-corner tr" />
        <div className="kaze-orb-corner bl" />
        <div className="kaze-orb-corner br" />

        <div className="kaze-orb-panel top-left">
          ZENITH CORE v2.4<br />
          SYS <span>{onlineStatus}</span><br />
          AUDIO <span>{audioMode}</span><br />
          FFT <span>{audioStats.fft || '-'}</span>
        </div>

        <div className="kaze-orb-panel top-right">
          NEURAL LINK<br />
          FREQ <span>{audioStats.frequencyHz ?? '-'}</span> Hz<br />
          AMP <span>{(audioStats.rawVolume * 100).toFixed(1)}%</span><br />
          BASS <span>{(audioStats.rawBass * 100).toFixed(1)}%</span><br />
          GATE <span>{(audioStats.noiseFloor * 100).toFixed(1)}%</span>
        </div>

        <div className="kaze-orb-panel bot-left">
          LAT <span>{coords.lat}</span><br />
          LON <span>{coords.lon}</span><br />
          LUANDA &middot; AOA
        </div>

        <div className="kaze-orb-panel bot-right">
          PARTICLES <span>{PARTICLE_COUNT}</span><br />
          FPS <span>{fps || '-'}</span><br />
          MODE <span>{mode}</span>
        </div>

        <div className="kaze-orb-status">
          <div className="kaze-orb-status-text">
            {mode} <span className="kaze-orb-dot">&middot;</span>
          </div>
          <div className="kaze-orb-vol-wrap">
            <div className="kaze-orb-vol-bar" style={{ width: `${displayedVolume}%` }} />
            <div className="kaze-orb-threshold" style={{ left: `${thresholdLeft}%` }} />
          </div>
        </div>

      </div>
    </div>
  );
}
