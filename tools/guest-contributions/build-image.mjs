import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './process.mjs';

const base = resolve(process.argv[2] || '.');
const tag = process.argv[3] || 'studynotes-guest-validator';
if (!/^[a-z0-9][a-z0-9:._/-]*$/.test(tag)) throw new Error('Invalid image tag');
const context = await mkdtemp(join(tmpdir(), 'studynotes-validator-build-'));
try {
  for (const file of ['package.json', 'package-lock.json']) {
    await copyFile(join(base, file), join(context, file));
  }
  for (const file of ['Dockerfile', 'validate.sh']) {
    await copyFile(new URL(file, import.meta.url), join(context, file));
  }
  await run('docker', ['build', '--pull', '--tag', tag, context], { timeout: 360_000, maxOutput: 2 * 1024 * 1024 });
  const id = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]);
  process.stdout.write(id);
} finally {
  await rm(context, { force: true, recursive: true });
}
