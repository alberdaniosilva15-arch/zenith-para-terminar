const fs = require('fs');
const path = require('path');

const OBSIDIAN_DIR = path.join(__dirname, '../obsidian memorias');
const OUTPUT_FILE  = path.join(__dirname, '../obsidian memorias/graph.json');

function generateGraph() {
  const files = fs.readdirSync(OBSIDIAN_DIR).filter(f => f.endsWith('.md'));
  const nodes = [];
  const links = [];

  files.forEach(f => {
    const content = fs.readFileSync(path.join(OBSIDIAN_DIR, f), 'utf8');
    const title   = f.replace('.md', '');
    nodes.push({ id: title, type: 'note' });

    // Encontra links do tipo [[Outra Nota]]
    const matches = content.match(/\[\[(.+?)\]\]/g);
    if (matches) {
      matches.forEach(m => {
        const target = m.replace('[[', '').replace(']]', '');
        links.push({ source: title, target: target });
      });
    }

    // Links automáticos por palavras-chave
    files.forEach(otherF => {
      const otherTitle = otherF.replace('.md', '');
      if (title !== otherTitle && content.toLowerCase().includes(otherTitle.toLowerCase())) {
        links.push({ source: title, target: otherTitle, type: 'auto' });
      }
    });
  });

  const graph = { nodes, links };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(graph, null, 2));
  console.log(`[GRAPHIFY] Grafo gerado com ${nodes.length} nós e ${links.length} conexões.`);
  console.log(`[GRAPHIFY] Salvo em: ${OUTPUT_FILE}`);
}

generateGraph();
