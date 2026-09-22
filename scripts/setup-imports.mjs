import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const python = process.env.PYTHON || 'python3';
const version = spawnSync(python, [
  '-c',
  'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)',
]);
if (version.status !== 0)
  throw new Error('Python 3.10+ is required. Set PYTHON to its executable path.');
for (const [bin, args] of [
  [python, ['-m', 'venv', '.data/import-venv']],
  [
    '.data/import-venv/bin/python',
    ['-m', 'pip', 'install', '-r', 'services/api/python/requirements.txt'],
  ],
]) {
  const result = spawnSync(bin, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Local PDF/XLS statement parser is ready.');
