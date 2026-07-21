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

function findDist(rootDir) {
  const tryPaths = [
    join(rootDir, 'dist', 'app.js'),
    join(rootDir, 'src', 'dist', 'app.js'),
    join(rootDir, '..', 'dist', 'app.js'),
    join(rootDir, '..', 'src', 'dist', 'app.js'),
    join(rootDir, '../..', 'dist', 'app.js'),
    join(rootDir, '../..', 'src', 'dist', 'app.js')
  ];

  for (const candidate of tryPaths) {
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

if (!root) {
  throw new Error(`Cannot find dist/app.js. Checked roots: ${candidates.join(', ')}`);
}

process.chdir(root);
console.log(`Starting from root: ${root}`);

await import(`file://${distPath}`);
