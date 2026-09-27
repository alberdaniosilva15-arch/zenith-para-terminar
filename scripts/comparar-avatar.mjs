// =============================================================================
// Teste: o avatar optimizado ainda tem o lip-sync?
// =============================================================================
// O `verificar-avatar.mjs` lê o GLB à mão e confirma a estrutura. Isto é
// diferente e complementar: carrega os DOIS ficheiros com o GLTFLoader real do
// three.js — o mesmo que o TalkingHead usa — e compara os nomes dos morph
// targets que o motor vai encontrar. É a diferença entre "o ficheiro diz que
// tem" e "o motor encontra".
//
// Uso:  node scripts/comparar-avatar.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ⚠️ O GLTFLoader do three.js assume ambiente de browser e usa `self` no topo do
// modulo. Sem isto, o `import` rebenta com "self is not defined" — antes de
// qualquer código nosso correr. Shim minimo, so o que ele toca.
globalThis.self = globalThis;

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const BASE = join(RAIZ, 'src/assets/kaze');

const loader = new GLTFLoader();

function inspecionar(caminho, nome) {
  const buf = readFileSync(caminho);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => {
    loader.parse(ab, '', (gltf) => {
      const morphs = new Set();
      const malhas = [];
      let verts = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          malhas.push(o.name);
          const d = o.geometry?.morphAttributes?.position;
          if (d) {
            verts += o.geometry.attributes.position.count;
            const dict = o.morphTargetDictionary || {};
            for (const k of Object.keys(dict)) morphs.add(k);
          }
        }
      });
      res({ nome, morphs: [...morphs].sort(), malhas, verts });
    }, rej);
  });
}

const VISEMES = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH'];

const ficheiros = [
  ['kaze-avatar.antes.glb', 'ANTES (35,1 MB)'],
  ['kaze-avatar.glb', 'AGORA (24,2 MB)'],
];

const resultados = [];
for (const [f, nome] of ficheiros) {
  try {
    resultados.push(await inspecionar(join(BASE, f), nome));
  } catch (e) {
    console.log(`  ${nome}: nao consegui carregar -> ${e.message}`);
  }
}

for (const r of resultados) {
  console.log('');
  console.log(`  ${r.nome}`);
  console.log(`    malhas ............. ${r.malhas.length}`);
  console.log(`    morphs distintos ... ${r.morphs.length}`);
  console.log(`    verts com morph .... ${r.verts}`);
  const faltaV = VISEMES.filter((v) => !r.morphs.includes('viseme_' + v));
  console.log(`    visemes ............ ${faltaV.length === 0 ? '14/14 OK' : 'FALTAM: ' + faltaV.join(', ')}`);
  const faltaB = ['eyeBlinkLeft', 'eyeBlinkRight'].filter((v) => !r.morphs.includes(v));
  console.log(`    blinks ............. ${faltaB.length === 0 ? 'OK' : 'FALTAM: ' + faltaB.join(', ')}`);
  console.log(`    jawOpen ............ ${r.morphs.includes('jawOpen') ? 'OK' : 'FALTA'}`);
}

if (resultados.length === 2) {
  const [a, n] = resultados;
  const iguais = JSON.stringify(a.morphs) === JSON.stringify(n.morphs);
  console.log('');
  console.log(`  Lista de morphs identica nos dois? ${iguais ? 'SIM' : 'NAO'}`);
  if (!iguais) {
    const soA = a.morphs.filter((m) => !n.morphs.includes(m));
    const soN = n.morphs.filter((m) => !a.morphs.includes(m));
    if (soA.length) console.log(`    so no ANTES: ${soA.join(', ')}`);
    if (soN.length) console.log(`    so no AGORA: ${soN.join(', ')}`);
  }
  console.log(`  Malhas do ANTES ausentes no AGORA: ${a.malhas.filter((m) => !n.malhas.includes(m)).join(', ') || '(nenhuma)'}`);
}
console.log('');
