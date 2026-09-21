const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const webDir = path.join(projectRoot, 'www');
const excludedEntries = new Set([
  '.env',
  '.git',
  'android',
  'node_modules',
  'package-lock.json',
  'package.json',
  'README.md',
  'capacitor.config.json',
  'render.yaml',
  'scripts',
  'server.js',
  'www'
]);

function copyWebEntry(entryName) {
  if (excludedEntries.has(entryName)) return;

  const source = path.join(projectRoot, entryName);
  const destination = path.join(webDir, entryName);
  const stats = fs.statSync(source);

  if (stats.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true });
    return;
  }

  if (path.extname(entryName).toLowerCase() !== '.txt') {
    fs.copyFileSync(source, destination);
  }
}

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
fs.readdirSync(projectRoot).forEach(copyWebEntry);

if (!fs.existsSync(path.join(webDir, 'index.html'))) {
  throw new Error('Web build did not produce index.html');
}

console.log(`Web build complete: ${path.relative(projectRoot, webDir)}`);