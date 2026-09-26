#!/usr/bin/env node
/**
 * Verifica se um ficheiro GLB serve como avatar do Kaze.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PORQUE ISTO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 * Um avatar sem os blend shapes certos NÃO falha de forma visível: carrega,
 * aparece no ecrã, os olhos até seguem a câmara — e a boca fica fechada para
 * sempre. Não há erro nenhum na consola. Foi exactamente esse tipo de falha
 * (silenciosa, plausível) que custou semanas no caso do Groq.
 *
 * Este script lê o JSON do GLB directamente e diz, antes de se trocar o
 * ficheiro, o que está lá e o que falta.
 *
 * USO
 *   node scripts/verificar-avatar.mjs                          # o avatar actual
 *   node scripts/verificar-avatar.mjs caminho/para/outro.glb    # um candidato
 *
 * Sai com código 1 se faltar algum requisito obrigatório — pronto para CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PADRAO = path.join(AQUI, '..', 'src', 'assets', 'kaze', 'kaze-avatar.glb');

/** Visemes Oculus — os 14 que o TalkingHead usa. `sil` não é morph target. */
const VISEMES = [
  'aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH',
];

/** ARKit mínimo para o avatar não parecer morto. */
const ARKIT_OBRIGATORIO = ['eyeBlinkLeft', 'eyeBlinkRight'];

/** Desejáveis — não bloqueiam, mas a ausência nota-se. */
const ARKIT_OPCIONAL = [
  'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'mouthPucker',
  'browInnerUp', 'browDownLeft', 'browDownRight', 'cheekPuff',
];

const GLB_MAGIC = 0x46546c67; // 'glTF' em little-endian

/**
 * Extrai o bloco JSON de um GLB.
 *
 * Um GLB é: header (12 bytes) + chunks. Cada chunk tem comprimento (4) e tipo
 * (4). O JSON é o primeiro chunk, com tipo `JSON` (0x4E4F534A).
 */
function lerGlb(caminho) {
  const buf = fs.readFileSync(caminho);

  if (buf.length < 12) throw new Error('ficheiro demasiado pequeno para ser GLB');
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('não começa com a assinatura "glTF"');

  const versao = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);

  let off = 12;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const tipo = buf.readUInt32LE(off + 4);
    if (tipo === 0x4e4f534a) {
      const json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
      return { json, versao, total, bytes: buf.length };
    }
    off += 8 + len;
  }
  throw new Error('não tem bloco JSON (GLB corrompido?)');
}

/** Nomes dos morph targets. Vivem no `extras.targetNames` de cada mesh. */
function nomesDeMorphTargets(json) {
  const nomes = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const n of mesh.extras?.targetNames ?? []) nomes.add(n);
  }
  return [...nomes].sort();
}

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const vermelho = (s) => `\x1b[31m${s}\x1b[0m`;
const amarelo = (s) => `\x1b[33m${s}\x1b[0m`;
const fraco = (s) => `\x1b[2m${s}\x1b[0m`;

function main() {
  const alvo = process.argv[2] ? path.resolve(process.argv[2]) : PADRAO;

  if (!fs.existsSync(alvo)) {
    console.error(vermelho(`✗ ficheiro não encontrado: ${alvo}`));
    process.exit(1);
  }

  console.log(`\n  avatar: ${path.basename(alvo)}`);
  console.log(fraco(`  ${(fs.statSync(alvo).size / 1048576).toFixed(1)} MB`));

  let dados;
  try {
    dados = lerGlb(alvo);
  } catch (e) {
    console.error(vermelho(`✗ GLB inválido: ${e.message}`));
    process.exit(1);
  }

  const { json, versao } = dados;
  console.log(fraco(`  glTF versão ${versao}`));

  const falhas = [];
  const avisos = [];

  // ── 1. Node raiz `Armature` ──────────────────────────────────────────────
  // O TalkingHead procura `this.opt.modelRoot` (default "Armature") e lança
  // "Avatar object Armature not found" se não existir.
  const temArmature = (json.nodes ?? []).some((n) => n.name === 'Armature');
  console.log('');
  if (temArmature) {
    console.log(`  ${verde('✓')} node raiz "Armature"`);
  } else {
    console.log(`  ${vermelho('✗')} node raiz "Armature" — o TalkingHead não vai encontrar o avatar`);
    falhas.push('node raiz "Armature"');
  }

  // ── 2. Blend shapes ──────────────────────────────────────────────────────
  const nomes = nomesDeMorphTargets(json);
  if (nomes.length === 0) {
    console.log(`  ${vermelho('✗')} nenhum blend shape — o TalkingHead lança "Blend shapes not found"`);
    falhas.push('blend shapes');
    process.exit(1);
  }
  console.log(`  ${verde('✓')} ${nomes.length} blend shapes no total`);

  // ── 3. Visemes Oculus (obrigatórios) ─────────────────────────────────────
  const visemesPresentes = VISEMES.filter((v) => nomes.includes(`viseme_${v}`));
  const visemesFalta = VISEMES.filter((v) => !nomes.includes(`viseme_${v}`));
  console.log('');
  if (visemesFalta.length === 0) {
    console.log(`  ${verde('✓')} os 14 visemes Oculus (lip-sync completo)`);
  } else if (visemesPresentes.length >= 8) {
    console.log(`  ${amarelo('!')} visemes: ${visemesPresentes.length}/14 — faltam ${visemesFalta.join(', ')}`);
    avisos.push(`${visemesFalta.length} visemes em falta`);
  } else {
    console.log(`  ${vermelho('✗')} só ${visemesPresentes.length}/14 visemes — a boca quase não se vai mexer`);
    falhas.push('visemes Oculus');
  }

  // ── 4. ARKit ─────────────────────────────────────────────────────────────
  const arkitFalta = ARKIT_OBRIGATORIO.filter((n) => !nomes.includes(n));
  if (arkitFalta.length === 0) {
    console.log(`  ${verde('✓')} piscar de olhos (eyeBlinkLeft/Right)`);
  } else {
    console.log(`  ${amarelo('!')} sem ${arkitFalta.join(', ')} — o avatar fica parado de olhos abertos`);
    avisos.push('sem piscar de olhos');
  }

  const opcPresentes = ARKIT_OPCIONAL.filter((n) => nomes.includes(n));
  if (opcPresentes.length) {
    console.log(fraco(`  · extras: ${opcPresentes.join(', ')}`));
  }

  // ── 5. Resumo ────────────────────────────────────────────────────────────
  console.log('');
  console.log(`  ${fraco(`meshes: ${json.meshes?.length ?? 0} · nodes: ${json.nodes?.length ?? 0} · materiais: ${json.materials?.length ?? 0} · texturas: ${json.textures?.length ?? 0}`)}`);
  console.log('');

  if (falhas.length) {
    console.log(vermelho(`  ✗ REPROVADO — falta: ${falhas.join('; ')}`));
    console.log('');
    process.exit(1);
  }

  if (avisos.length) {
    console.log(amarelo(`  ! PASSA COM AVISOS — ${avisos.join('; ')}`));
    console.log('');
    process.exit(0);
  }

  console.log(verde('  ✓ APROVADO — este avatar serve para o Kaze'));
  console.log('');
}

main();
