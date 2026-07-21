import { existsSync } from 'fs';
import { join, resolve } from 'path';

const cwd = process.cwd();
const candidates = [cwd, resolve(cwd, '..'), resolve(cwd, '../..'), resolve(cwd, '../../..')];
let root = null;

for (const dir of candidates) {
  const distPath = join(dir, 'dist', 'app.js');
  if (existsSync(distPath)) {
    root = dir;
    break;
  }
}

if (!root) {
  throw new Error(`Cannot find dist/app.js. Checked: ${candidates.join(', ')}`);
}

process.chdir(root);
console.log(`Starting from root: ${root}`);
const distPath = join(root, 'dist', 'app.js');

await import(`file://${distPath}`);
