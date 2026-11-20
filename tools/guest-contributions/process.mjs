import { spawn } from 'node:child_process';

export function run(command, args, { env = {}, input, timeout = 30_000, maxOutput = 4 * 1024 * 1024 } = {}) {
  const childEnv = {
    PATH: process.env.PATH,
    ...(process.platform === 'win32' && { SystemRoot: process.env.SystemRoot,
      USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA }),
    ...(process.env.HOME && { HOME: process.env.HOME }),
    ...(process.env.XDG_RUNTIME_DIR && { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }),
    ...(process.env.DOCKER_HOST && { DOCKER_HOST: process.env.DOCKER_HOST }),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ATTR_NOSYSTEM: '1',
    ...env,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv, windowsHide: true });
    let size = 0;
    let stop = '';
    const output = [];
    const abort = reason => {
      stop ||= reason;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => abort('timed out'), timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxOutput) abort('exceeded output limit');
      else output.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error(command + ' could not start'));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0 && !stop) resolve(Buffer.concat(output));
      else reject(new Error(command + ' ' + (stop || 'exit ' + code)));
    });
    child.stdin.end(input);
  });
}
