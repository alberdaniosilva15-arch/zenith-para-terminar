// src/lib/driverMarker.ts
// Utilitário isolado para criar o elemento HTML do marcador do motorista.
// Extraído de Map3D.tsx para resolver o conflito de import estático/dinâmico
// que impedia o code-splitting do Vite.

/**
 * Cria e retorna um elemento HTML personalizado para o marcador Mapbox do motorista.
 * @param heading ângulo de direção em graus (0 = Norte)
 */
export function createDriverMarkerElement(heading: number = 0): HTMLElement {
  const el = document.createElement("div");
  el.className = "zenith-driver-marker";
  el.style.cssText = `
    width: 40px;
    height: 40px;
    transform: rotate(${heading}deg);
    transition: transform 0.3s ease;
    cursor: pointer;
  `;
  el.innerHTML = `
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="#1e293b" stroke="#3B82F6" stroke-width="2"/>
      <path d="M20 8 L28 28 L20 24 L12 28 Z" fill="#3B82F6"/>
    </svg>
  `;
  return el;
}
