// A tools-disabled local-model session, intentionally separate from the finance API.
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const base = resolve('.data/prime');
const config = resolve(base, 'config');
await mkdir(config, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(config, 'models.json'),
  JSON.stringify(
    {
      providers: {
        'finsight-local': {
          baseUrl: 'http://127.0.0.1:11434/v1',
          api: 'openai-completions',
          apiKey: 'ollama',
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [
            {
              id: 'qwen3:8b',
              name: 'FinSight local Qwen3',
              contextWindow: 8192,
              maxTokens: 1024,
              reasoning: false,
            },
          ],
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
const workspace = await mkdtemp(resolve(base, 'test-'));
const child = spawn(
  resolve(base, 'bin/prime-agent'),
  [
    '--cwd',
    workspace,
    '--offline',
    '--provider',
    'finsight-local',
    '--model',
    'qwen3:8b',
    '--thinking',
    'off',
    '--no-tools',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--no-session',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TERM: process.env.TERM,
      PRIME_AGENT_CODING_AGENT_DIR: config,
      PI_OFFLINE: '1',
    },
  },
);
child.on('error', () => {
  console.error('Install Prime Agent into .data/prime/bin first; see docs/LOCAL_AI.md');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
