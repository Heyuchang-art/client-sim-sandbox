import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

/**
 * 以 esbuild 打包单个 TS 入口后在本机 Node 中运行。
 * 这样评测/基准脚本可以像应用代码一样使用目录导入与 @/ 别名，
 * 而不必为了 Node 的原生类型擦除去改写源码导入路径。
 */
const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run.mjs <entry.ts> [args...]');
  process.exit(1);
}

const outfile = resolve('.tmp', entry.replace(/[\\/]/g, '_').replace(/\.ts$/, '.mjs'));
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  logLevel: 'warning',
});

const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
