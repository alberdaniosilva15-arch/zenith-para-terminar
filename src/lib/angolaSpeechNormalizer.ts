// =============================================================================
// ZENITH RIDE — angolaSpeechNormalizer.ts
// Pós-processador fonético de áudio e transcrição para Português de Angola.
// Corrige confusões fonéticas habituais do Whisper / Web Speech API quando
// utilizadores angolanos falam sobre bairros, quarteirões, zonas e destinos.
// =============================================================================

export function normalizeAngolanSpeech(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();

  // 1. Quarteirões do Kilamba (Fonética de letras faladas)
  text = text
    .replace(/\bquarteir[aã]o\s+[aáàâã](\b|\s|$)/gi, 'Quarteirão A ')
    .replace(/\bquarteir[aã]o\s+(?:b[eê]|bê)(\b|\s|$)/gi, 'Quarteirão B ')
    .replace(/\bquarteir[aã]o\s+(?:c[eê]|cê)(\b|\s|$)/gi, 'Quarteirão C ')
    .replace(/\bquarteir[aã]o\s+(?:d[eê]|dê)(\b|\s|$)/gi, 'Quarteirão D ')
    .replace(/\bquarteir[aã]o\s+[eéèê](\b|\s|$)/gi, 'Quarteirão E ')
    .replace(/\bquarteir[aã]o\s+(?:efe|f)(\b|\s|$)/gi, 'Quarteirão F ')
    .replace(/\bquarteir[aã]o\s+(?:g[eê]|gê|g)(\b|\s|$)/gi, 'Quarteirão G ')
    .replace(/\bquarteir[aã]o\s+(?:ag[aá]|aga|h)(\b|\s|$)/gi, 'Quarteirão H ')
    .replace(/\bquarteir[aã]o\s+[ií](\b|\s|$)/gi, 'Quarteirão I ')
    .replace(/\bquarteir[aã]o\s+(?:jota|j)(\b|\s|$)/gi, 'Quarteirão J ')
    .replace(/\bquarteir[aã]o\s+(?:k[aá]|c[aá]|k)(\b|\s|$)/gi, 'Quarteirão K ')
    .replace(/\bquarteir[aã]o\s+(?:[eé]le|ele|l)(\b|\s|$)/gi, 'Quarteirão L ')
    .replace(/\bquarteir[aã]o\s+(?:[eé]me|eme|m)(\b|\s|$)/gi, 'Quarteirão M ')
    .replace(/\bquarteir[aã]o\s+(?:[eé]ne|ene|n)(\b|\s|$)/gi, 'Quarteirão N ')
    .replace(/\bquarteir[aã]o\s+[oóòôõ](\b|\s|$)/gi, 'Quarteirão O ')
    .replace(/\bquarteir[aã]o\s+(?:p[eê]|pê|p)(\b|\s|$)/gi, 'Quarteirão P ')
    .replace(/\bquarteir[aã]o\s+(?:qu[eê]|quê|q)(\b|\s|$)/gi, 'Quarteirão Q ')
    .replace(/\bquarteir[aã]o\s+(?:[eé]rre|erre|r)(\b|\s|$)/gi, 'Quarteirão R ')
    .replace(/\bquarteir[aã]o\s+(?:[eé]sse|esse|s)(\b|\s|$)/gi, 'Quarteirão S ')
    .replace(/\bquarteir[aã]o\s+(?:t[eê]|tê|t)(\b|\s|$)/gi, 'Quarteirão T ')
    .replace(/\bquarteir[aã]o\s+[uú](\b|\s|$)/gi, 'Quarteirão U ');

  // 2. Golf 1 e Golf 2 e Zonas
  text = text
    .replace(/\b(?:golf|golfe|gof)\s*(?:dois|2)\b/gi, 'Golf 2')
    .replace(/\b(?:golf|golfe|gof)\s*(?:um|1)\b/gi, 'Golf 1')
    .replace(/\bkk\s*(?:cinco\s*mil|5000)\b/gi, 'KK 5000')
    .replace(/\bk\s*k\s*(?:cinco\s*mil|5000)\b/gi, 'KK 5000')
    .replace(/\bzango\s*zero\b/gi, 'Zango 0')
    .replace(/\bzango\s*um\b/gi, 'Zango 1')
    .replace(/\bzango\s*dois\b/gi, 'Zango 2')
    .replace(/\bzango\s*tr[eê]s\b/gi, 'Zango 3')
    .replace(/\bzango\s*quatro\b/gi, 'Zango 4')
    .replace(/\bzango\s*cinco\b/gi, 'Zango 5');

  // 3. Destinos e Bairros de Luanda frequentemente transcritos com erro
  const replacements: [RegExp, string][] = [
    // Talatona
    [/\b(?:talha\s*tona|talha-tona|tala\s*tona|talatona)\b/gi, 'Talatona'],
    // Viana
    [/\b(?:via\s*na|vila\s*na|vianna)\b/gi, 'Viana'],
    // Cazenga
    [/\b(?:ca[zs]enga|ca[zs]enha|casa\s*enga|kazenga)\b/gi, 'Cazenga'],
    // Kilamba
    [/\b(?:quilamba|quilamba\s*quiaxi|kilamba\s*kiaxi)\b/gi, 'Kilamba'],
    // Morro Bento
    [/\b(?:morro\s*dentro|morro\s*vento|morro\s*bento)\b/gi, 'Morro Bento'],
    // Cacuaco
    [/\b(?:cacu[aá]co|kakuako)\b/gi, 'Cacuaco'],
    // Kinaxixi
    [/\b(?:quinaxixe|quinaxixi|kinaxixe|kinaxixi)\b/gi, 'Kinaxixi'],
    // Sambizanga
    [/\b(?:sam\s*bizanga|sambisanga|sambizanga)\b/gi, 'Sambizanga'],
    // Bairro Operário
    [/\b(?:bairro\s*oper[aá]rio|bairro\s*operario)\b/gi, 'Bairro Operário'],
    // Alvalade
    [/\b(?:alvalad|alvalade)\b/gi, 'Alvalade'],
    // Maianga
    [/\b(?:mayanga|maianga)\b/gi, 'Maianga'],
    // Sequele
    [/\b(?:sequel|sequele)\b/gi, 'Sequele'],
    // Rocha Pinto
    [/\b(?:rocha\s*pinto)\b/gi, 'Rocha Pinto'],
    // Mundo Verde
    [/\b(?:mundo\s*verde)\b/gi, 'Mundo Verde'],
    // Belas Shopping
    [/\b(?:bela\s*shopping|belas\s*shopping)\b/gi, 'Belas Shopping'],
    // Lar do Patriota
    [/\b(?:lar\s*do\s*patriota|patriota)\b/gi, 'Lar do Patriota'],
    // Nova Vida
    [/\b(?:nova\s*vida)\b/gi, 'Nova Vida'],
    // Aeroporto 4 de Fevereiro
    [/\b(?:aeroporto\s*quatro\s*de\s*fevereiro|aeroporto\s*4\s*de\s*fevereiro)\b/gi, 'Aeroporto 4 de Fevereiro'],
    // Ilha do Cabo
    [/\b(?:ilha\s*do\s*cabo|ilha\s*de\s*luanda)\b/gi, 'Ilha do Cabo'],
    // Mutamba
    [/\b(?:mutamba|baixa\s*de\s*luanda)\b/gi, 'Mutamba'],
    // Maculusso
    [/\b(?:maculusso|maculuso)\b/gi, 'Maculusso'],
    // Kikuxi
    [/\b(?:quicuxi|kikuxi)\b/gi, 'Kikuxi'],
    // Estalagem
    [/\b(?:estalagem)\b/gi, 'Estalagem'],
    // Capalanga
    [/\b(?:capalanga)\b/gi, 'Capalanga'],
    // Panguila
    [/\b(?:panguila)\b/gi, 'Panguila'],
    // Kikolo
    [/\b(?:quicolo|kikolo)\b/gi, 'Kikolo'],
  ];

  for (const [pattern, target] of replacements) {
    text = text.replace(pattern, target);
  }

  // 4. Limpeza de espaços duplos
  return text.replace(/\s+/g, ' ').trim();
}
