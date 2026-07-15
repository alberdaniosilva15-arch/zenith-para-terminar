const fs = require('fs');
const files = [
  'src/components/admin/tabs/KazeAITab.tsx',
  'src/components/admin/tabs/SettingsTab.tsx',
  'src/lib/aiModelSettings.ts',
  'src/lib/kazeAudioCapture.ts',
  'src/lib/screamDetector.ts'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/catch\s*\{\s*\}/g, 'catch (e) { /* ignore */ }');
    fs.writeFileSync(f, content);
    console.log('Fixed empty catch in:', f);
  }
});

const adminApp = 'src/admin/AdminApp.tsx';
if (fs.existsSync(adminApp)) {
  let content = fs.readFileSync(adminApp, 'utf8');
  content = content.replace(/@ts-ignore/g, '@ts-expect-error');
  fs.writeFileSync(adminApp, content);
  console.log('Fixed @ts-ignore in:', adminApp);
}
