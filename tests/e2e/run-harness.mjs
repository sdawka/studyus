import { spawn } from 'node:child_process';

/** Run an existing assertion-heavy browser harness under Playwright's server lifecycle. */
export function runHarness(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, E2E_USE_STORED_AUTH: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const forward = (stream, destination) => {
      stream.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        destination.write(text);
      });
    };
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${script} failed (${signal ? `signal ${signal}` : `exit ${code}`}):\n${output}`));
    });
  });
}
