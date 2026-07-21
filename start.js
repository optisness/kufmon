import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const cwd = process.cwd();
const startDir = dirname(fileURLToPath(import.meta.url));
const candidates = [
  startDir,
  cwd,
  resolve(startDir, '..'),
  resolve(cwd, '..'),
  resolve(startDir, '../..'),
  resolve(cwd, '../..'),
  resolve(startDir, '../../..'),
  resolve(cwd, '../../..')
];
let root = null;
let distPath = null;
const checked = [];

function findDist(rootDir) {
  const tryPaths = [
    join(rootDir, 'dist', 'app.js'),
    join(rootDir, 'src', 'dist', 'app.js'),
    join(rootDir, '..', 'dist', 'app.js'),
    join(rootDir, '..', 'src', 'dist', 'app.js'),
    join(rootDir, '../..', 'dist', 'app.js'),
    join(rootDir, '../..', 'src', 'dist', 'app.js'),
    join(rootDir, 'app.js'),
    join(rootDir, '../app.js'),
    join(rootDir, '../..', 'app.js')
  ];

  for (const candidate of tryPaths) {
    checked.push(candidate);
    if (existsSync(candidate)) {
      distPath = candidate;
      return true;
    }
  }

  return false;
}

for (const dir of candidates) {
  if (findDist(dir)) {
    root = dir;
    break;
  }
}

console.log('start.js cwd:', cwd);
console.log('start.js file location:', startDir);
console.log('Checked candidate roots:', candidates);
console.log('Checked dist paths:', checked);

if (!root) {
  throw new Error(`Cannot find dist/app.js. Checked: ${checked.join(', ')}`);
}

process.chdir(root);
console.log(`Starting from root: ${root}`);
console.log(`Loading dist app from: ${distPath}`);

try {
  await import(`file://${distPath}`);
} catch (err) {
  console.error('Failed to import dist/app.js:', err);
  throw err;
}
