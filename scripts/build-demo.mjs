// npm run build:demo — the clickable demo as a static site in out/ (for GitHub Pages or any static host).
//
// The demo engine runs in the browser, so the server-only parts are left out: the build happens in a copy of the
// project (.pages-build/) without app/api and without the /studio/<id> route (the static site uses /studio/?id=).
// The working tree is not touched, so a running `npm run dev` keeps working.
//
//   NEXT_PUBLIC_BASE_PATH=/inkframe npm run build:demo     # served at https://<user>.github.io/inkframe/
//   npm run build:demo                                     # served at the root of a domain
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const work = join(root, '.pages-build');
// --out=<dir> picks the output folder (default out/)
const outArg = process.argv.find(a => a.startsWith('--out='));
const out = join(root, outArg ? outArg.slice(6) : 'out');
const skip = new Set(['node_modules', '.next', '.git', '.pages-build', 'out', 'out-artifact', 'projects', 'demo', 'app/api', 'app/studio/[id]',
  'package-lock.json', '.env.local']);

rmSync(work, { recursive: true, force: true });
for (const name of readdirSync(root)) {   // entry by entry: cpSync refuses to copy a folder into itself
  if (!skip.has(name)) cpSync(join(root, name), join(work, name), { recursive: true, filter: src => !skip.has(relative(root, src)) });
}

// No node_modules in the copy: Node and Next find the project's own one level up.
const env = { ...process.env, INKFRAME_STATIC: '1', NEXT_PUBLIC_INKFRAME_STATIC: '1', NEXT_TELEMETRY_DISABLED: '1' };
const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const r = spawnSync(process.execPath, [next, 'build'], { cwd: work, env, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

rmSync(out, { recursive: true, force: true });
renameSync(join(work, 'out'), out);
writeFileSync(join(out, '.nojekyll'), '');   // keep GitHub Pages from hiding the _next/ folder
rmSync(work, { recursive: true, force: true });
if (!existsSync(join(out, 'index.html'))) { console.error('build:demo: out/index.html is missing'); process.exit(1); }
console.log(`build:demo: static site in ${relative(root, out)}/ (base path: ${env.NEXT_PUBLIC_BASE_PATH || '/'})`);
