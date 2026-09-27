#!/usr/bin/env node
// =============================================================================
// ZENITH RIDE — Optimizador do avatar do Kaze
// =============================================================================
//
// PORQUE ISTO EXISTE
//
// O avatar do Kaze (mpfb.glb) tinha 36,8 MB. Medido, o peso não estava onde
// parecia: a geometria e os 66 morph targets do lip-sync somam apenas 16,4 MB
// e já estão bem guardados (sparse accessors — 96% dos vértices de um viseme
// não se mexem, e isso é correcto). O que estava mal era:
//
//   1. AS TEXTURAS ERAM PNG. 18,5 MB em PNG dentro de um GLB. Textura de
//      superfície não precisa de ser sem perdas; precisa de ser pequena.
//      O maior culpado isolado: um normal map de ROUPA a 4096x4096 = 5,48 MB.
//
//   2. A ROUPA E O CABELO NÃO APARECEM NO ECRÃ. A câmara do KazeAvatar está a
//      y=1.62, z=0.62, FOV 28° — um plano fechado de cara, dentro de um círculo
//      de 106px. Os 3,55 MB de pele + 2,88 MB de difusa de fato + 3,73 MB de
//      rabo de cavalo (12,4 MB com a geometria) são carregados, descodificados
//      e enviados para a GPU — para serem desenhados fora do enquadramento.
//
// O QUE ESTE SCRIPT FAZ, por isso:
//
//   A. Reencoda cada textura no formato que lhe serve:
//        - sem alpha  -> JPEG (qualidade alta)  [difusa, normal map]
//        - com alpha  -> PNG mas reduzido, ou JPEG quando o alpha é ignorável
//      Decisão POR textura, não em bloco: o `brown_eye` tem alpha real (a
//      íris é um recorte) e ficaria com fundo preto se fosse JPEG à força.
//
//   B. Opcionalmente remove as malhas que não aparecem no enquadramento
//      (roupa, cabelo), com uma lista explícita — nunca por suposição.
//
// ⚠️ O QUE NÃO FAZ: não toca nos morph targets. Um ápice que se mexa aqui e o
// Kaze fica de boca fechada. Há `scripts/verificar-avatar.mjs` no build para
// garantir exactamente isso.
//
// USO
//   node scripts/optimizar-avatar.mjs                     # só relatório
//   node scripts/optimizar-avatar.mjs --aplicar           # escreve o GLB
//   node scripts/optimizar-avatar.mjs --aplicar --sem-roupa
//
// O resultado vai para `kaze-avatar.opt.glb`; a substituição do original é
// deliberadamente MANUAL, para se poder comparar lado a lado antes de trocar.
// =============================================================================

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const ORIGEM = join(RAIZ, 'src/assets/kaze/kaze-avatar.glb');
const DESTINO = join(RAIZ, 'src/assets/kaze/kaze-avatar.opt.glb');

// O Python com Pillow vive no ambiente isolado. Não usar o do sistema: pode
// não ter Pillow e não queremos instalar nada globalmente.
const PYTHON_CANDIDATOS = [
  'C:/Users/Ariane Marcelino/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe',
  'C:/Users/Ariane Marcelino/.workbuddy-ai/binaries/python/envs/default/bin/python',
];

const APLICAR = process.argv.includes('--aplicar');
const SEM_ROUPA = process.argv.includes('--sem-roupa');

// Malhas que não entram no enquadramento do Kaze (câmara a y=1.62, FOV 28°).
// Lista explícita e comentada: esquecer uma é inofensivo (fica peso a mais),
// apagar a errada parte o avatar. O `base` (a cara, com os 66 morphs) NUNCA
// entra aqui.
const MALHAS_FORA_DE_CENA = new Set([
  'female_casualsuit01', // fato casual — o corpo não aparece
  'ponytail01',          // rabo de cavalo — fora do enquadramento
]);

function acharPython() {
  for (const p of PYTHON_CANDIDATOS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function leChunks(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('não é um GLB (magic != glTF)');
  const versao = dv.getUint32(4, true);
  const chunks = {};
  let off = 12;
  while (off < buf.length) {
    const len = dv.getUint32(off, true);
    const tipo = dv.getUint32(off + 4, true);
    chunks[tipo] = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  return { versao, chunks };
}

function main() {
  if (!existsSync(ORIGEM)) {
    console.error(`  ✗ não encontrei o avatar em ${ORIGEM}`);
    process.exit(1);
  }

  const py = acharPython();
  if (!py) {
    console.error('  ✗ não encontrei o Python com Pillow no ambiente isolado.');
    console.error('    Corre: <python-managed> -m venv <env> && <env>/pip install Pillow');
    process.exit(1);
  }

  const bruto = readFileSync(ORIGEM);
  const { versao, chunks } = leChunks(bruto);
  const TEXTO = 0x4e4f534a;
  const BIN = 0x004e4942;
  const json = JSON.parse(chunks[TEXTO].toString('utf-8'));

  console.log('');
  console.log(`  avatar ................. ${ORIGEM.split(/[\\/]/).pop()}`);
  console.log(`  tamanho ................ ${(bruto.length / 1048576).toFixed(1)} MB`);
  console.log(`  glTF versão ............ ${versao}`);
  console.log(`  malhas ................. ${json.meshes?.length ?? 0}`);
  console.log(`  texturas ............... ${json.images?.length ?? 0}`);
  console.log('');

  // O trabalho pesado (descodificar/reencodar as imagens) fica no Python, que
  // tem Pillow. O Node trata da estrutura do GLB. Chamamos um script inline
  // por stdin: nada de ficheiros temporários no repositório.
  const pedido = {
    origem: ORIGEM,
    destino: DESTINO,
    aplicar: APLICAR,
    semRoupa: SEM_ROUPA,
    malhasForaDeCena: [...MALHAS_FORA_DE_CENA],
  };

  const scriptPy = `
import sys, json, struct, io
from PIL import Image

p = json.loads(sys.stdin.read())
ORIGEM, DESTINO = p['origem'], p['destino']

d = open(ORIGEM, 'rb').read()
dv = memoryview(d)
off = 12
chunks = {}
while off < len(d):
    ln, ty = struct.unpack('<II', d[off:off+8])
    chunks[ty] = d[off+8:off+8+ln]
    off += 8 + ln
TEXTO, BIN = 0x4E4F534A, 0x004E4942
j = json.loads(chunks[TEXTO].decode('utf-8'))
blob = chunks[BIN]
bvs = j['bufferViews']

def bytes_de_bv(i):
    bv = bvs[i]
    o = bv.get('byteOffset', 0)
    return blob[o:o+bv['byteLength']]

# ---- decidir o formato de cada textura ----
decisoes = []
for i, im in enumerate(j.get('images', [])):
    raw = bytes_de_bv(im['bufferView'])
    img = Image.open(io.BytesIO(raw))
    nome = im.get('name', f'img{i}')

    # Alpha real = ha pixeis transparentes. Um canal RGBA todo a 255 nao conta:
    # e so um canal a mais a ocupar espaco.
    tem_alpha_real = False
    if img.mode in ('RGBA', 'LA'):
        a = img.convert('RGBA').getchannel('A')
        lo, hi = a.getextrema()
        tem_alpha_real = lo < 250

    # Normal maps nao podem ser JPEG a qualidade baixa: o artefacto aparece
    # como ondulacao na superficie iluminada. Qualidade alta e obrigatoria.
    e_normal = 'normal' in nome.lower()

    if tem_alpha_real:
        formato, qualidade, motivo = 'PNG', None, 'alpha real (recorte)'
    elif e_normal:
        formato, qualidade, motivo = 'JPEG', 92, 'normal map (q alta)'
    else:
        formato, qualidade, motivo = 'JPEG', 88, 'difusa'

    decisoes.append({
        'i': i, 'nome': nome, 'tam': img.size, 'modo': img.mode,
        'formato': formato, 'qualidade': qualidade, 'motivo': motivo,
        'bytes_antes': len(raw),
    })

for dd in decisoes:
    print(f"    [{dd['i']}] {str(dd['nome'])[:30]:30} {dd['tam'][0]}x{dd['tam'][1]:<5} "
          f"{dd['bytes_antes']/1048576:6.2f} MB -> {dd['formato']:4}  ({dd['motivo']})")

if not p['aplicar']:
    antes = sum(dd['bytes_antes'] for dd in decisoes)
    print('')
    print(f"    texturas agora: {antes/1048576:.1f} MB")
    print('')
    print('    (relatorio apenas - usar --aplicar para escrever o ficheiro)')
    sys.exit(0)

# ---- reencodar ----
novos_bytes = []
for dd in decisoes:
    raw = bytes_de_bv(j['images'][dd['i']]['bufferView'])
    img = Image.open(io.BytesIO(raw))

    if dd['formato'] == 'JPEG':
        # JPEG nao guarda alpha. Se o modo tem alpha (mesmo que nao usado),
        # achatar sobre branco em vez de deixar o Pillow falhar.
        if img.mode in ('RGBA', 'LA', 'P'):
            fundo = Image.new('RGB', img.size, (255, 255, 255))
            conv = img.convert('RGBA')
            fundo.paste(conv, mask=conv.getchannel('A'))
            img = fundo
        else:
            img = img.convert('RGB')
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=dd['qualidade'], optimize=True, progressive=True)
    else:
        img = img.convert('RGBA')
        # PNG com compressao maxima: e a unica forma de manter o recorte.
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True)

    novos_bytes.append((dd, buf.getvalue()))

# ---- reconstruir o BIN ----
# Estrategia conservadora: manter TODOS os bufferViews actuais intactos, e
# simplesmente trocar o conteudo dos que sao textura. Evita recalcular offsets
# de accessors, que e onde um erro silencioso partiria o lip-sync.
subs = {}
for dd, novo in novos_bytes:
    subs[j['images'][dd['i']]['bufferView']] = novo

partes = []
novos_bvs = []
pos = 0
for bi, bv in enumerate(bvs):
    dados = subs.get(bi)
    if dados is None:
        dados = bytes_de_bv(bi)
    # alinhamento a 4 bytes, exigido pela spec do glTF
    pad = (-len(dados)) % 4
    novos_bvs.append({'buffer': 0, 'byteOffset': pos, 'byteLength': len(dados)})
    partes.append(dados + b'\\x00' * pad)
    pos += len(dados) + pad

j['bufferViews'] = novos_bvs
for dd, novo in novos_bytes:
    mime = 'image/jpeg' if dd['formato'] == 'JPEG' else 'image/png'
    j['images'][dd['i']]['mimeType'] = mime

# ---- remover malhas fora de cena (opcional) ----
if p['semRoupa']:
    remover = set()
    for mi, m in enumerate(j.get('meshes', [])):
        if m.get('name') in p['malhasForaDeCena']:
            remover.add(mi)
    if remover:
        # Tirar as malhas da lista de meshes obriga a remapear os indices nos
        # nodes. Fazer isso mal deixa nodes a apontar para a malha errada.
        # Mais seguro: deixar a malha mas tirar-lhe as primitives (fica vazia,
        # nao desenha nada, e nenhum indice muda de sitio).
        for mi in remover:
            nm = j['meshes'][mi].get('name')
            j['meshes'][mi]['primitives'] = []
            print(f"    - esvaziada a malha '{nm}' (fora do enquadramento)")

novo_bin = b''.join(partes)

# ---- empacotar ----
texto = json.dumps(j, separators=(',', ':')).encode('utf-8')
texto += b' ' * ((-len(texto)) % 4)
binp = novo_bin + b'\\x00' * ((-len(novo_bin)) % 4)

total = 12 + 8 + len(texto) + 8 + len(binp)
saida = bytearray()
saida += struct.pack('<4sII', b'glTF', 2, total)
saida += struct.pack('<II', len(texto), TEXTO) + texto
saida += struct.pack('<II', len(binp), BIN) + binp

open(DESTINO, 'wb').write(bytes(saida))

antes = len(d)
depois = len(saida)
print('')
print(f"    escrito: {DESTINO}")
print(f"    {antes/1048576:7.1f} MB  ->  {depois/1048576:7.1f} MB   "
      f"(-{100*(antes-depois)/antes:.0f}%)")
`;

  try {
    // ⚠️ NAO passar o script Python por `-c`: sao varias linhas, o Node recusa
    // argumentos com bytes nulos/quebras, e o erro que sai (`args[1] must be a
    // string without null bytes`) nao aponta para a causa. Escrito num ficheiro
    // temporario DENTRO do repo (o /tmp nao existe neste ambiente) e apagado no
    // fim, mesmo em caso de falha.
    const pyTemp = join(RAIZ, '.tmp-optimizar-avatar.py');
    writeFileSync(pyTemp, scriptPy, 'utf-8');
    try {
      const saida = execFileSync(py, [pyTemp], {
        input: JSON.stringify(pedido),
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
      });
      process.stdout.write(saida);
    } finally {
      try { rmSync(pyTemp, { force: true }); } catch { /* nao vale a pena falhar por isto */ }
    }
  } catch (e) {
    console.error('  ✗ falhou:');
    console.error(e.stderr || e.message);
    process.exit(1);
  }

  if (APLICAR) {
    console.log('');
    console.log('  ⚠️  O original NÃO foi substituído, de propósito.');
    console.log(`      Compara os dois e só depois troca:`);
    console.log(`        mv src/assets/kaze/kaze-avatar.glb src/assets/kaze/kaze-avatar.antes.glb`);
    console.log(`        mv src/assets/kaze/kaze-avatar.opt.glb src/assets/kaze/kaze-avatar.glb`);
    console.log('        npm run avatar:check     # tem de continuar APROVADO');
    console.log('        npm run build            # o tamanho na consola nao deve mudar de mais');
    console.log('');
  }
}

main();
