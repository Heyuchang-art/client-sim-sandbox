import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const workspace = resolve(process.cwd());
const target = resolve(workspace, 'securities-customer-sandbox', 'artifacts', 'legacy');
if (!target.startsWith(workspace + sep)) throw new Error('refusing to touch outside workspace');
mkdirSync(target, { recursive: true });

const source = resolve(workspace, 'artifacts', 'legacy');
const moved = [];
if (existsSync(source)) {
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    if (!from.startsWith(source + sep) || !statSync(from).isFile()) continue;
    renameSync(from, join(target, name));
    moved.push(name);
  }
  try {
    rmdirSync(resolve(workspace, 'artifacts', 'legacy'));
    rmdirSync(resolve(workspace, 'artifacts'));
  } catch {
    // 目录非空则保留
  }
}
console.log('moved into repo artifacts/legacy: ' + (moved.join('、') || '无'));
