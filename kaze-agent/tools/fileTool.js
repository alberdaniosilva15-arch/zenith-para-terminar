const fs   = require('fs');
const path = require('path');

const ALLOWED_BASE_PATHS = [
  path.resolve(process.cwd(), 'kaze-workspace'),
  path.resolve(process.cwd(), 'uploads'),
  path.resolve(process.cwd(), 'exports'),
  path.resolve(process.cwd(), 'reports'),
];

// Nomes proibidos em qualquer segmento do path
const FORBIDDEN_SEGMENTS = [
  '.env', '.env.local', '.env.production', '.env.development',
  'package.json', 'package-lock.json', 'yarn.lock',
  'node_modules', 'supabase', '.git', '.kaze-token',
  'next.config', 'vite.config', 'tsconfig', 'webpack.config',
];

function isAllowedPath(targetPath) {
  let resolved;
  try {
    resolved = fs.existsSync(targetPath)
      ? fs.realpathSync(targetPath)          // resolve symlinks
      : path.resolve(targetPath);
  } catch {
    return false;
  }

  const segments = resolved.split(path.sep);
  if (FORBIDDEN_SEGMENTS.some(f => segments.some(s => s === f || s.startsWith(f)))) {
    return false;
  }

  // Deve estar dentro de um path autorizado
  return ALLOWED_BASE_PATHS.some(base =>
    resolved === base || resolved.startsWith(base + path.sep)
  );
}

// Garante workspace
if (!fs.existsSync(path.resolve(process.cwd(), 'kaze-workspace'))) {
  fs.mkdirSync(path.resolve(process.cwd(), 'kaze-workspace'), { recursive: true });
}

const fileTool = {
  listDir: (dirPath) => {
    if (!isAllowedPath(dirPath)) return { error: 'Caminho não permitido' };
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return { items: items.map(i => ({ name: i.name, type: i.isDirectory() ? 'dir' : 'file' })) };
    } catch (e) { return { error: e.message }; }
  },

  readFile: (filePath) => {
    if (!isAllowedPath(filePath)) return { error: 'Caminho não permitido' };
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return { content: content.substring(0, 10_000) };
    } catch (e) { return { error: e.message }; }
  },

  createFolder: (dirPath) => {
    if (!isAllowedPath(dirPath)) return { error: 'Caminho não permitido' };
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true, path: dirPath };
    } catch (e) { return { error: e.message }; }
  },

  writeFile: (filePath, content, confirmed = false) => {
    if (!isAllowedPath(filePath)) return { error: 'Caminho não permitido' };
    if (!confirmed) return { requiresConfirmation: true, action: `Escrever em: ${filePath}` };
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true };
    } catch (e) { return { error: e.message }; }
  },

  deleteFile: (filePath, confirmed = false) => {
    if (!isAllowedPath(filePath)) return { error: 'Caminho não permitido' };
    if (!confirmed) return { requiresConfirmation: true, action: `Apagar permanentemente: ${filePath}` };
    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (e) { return { error: e.message }; }
  },
};

module.exports = fileTool;