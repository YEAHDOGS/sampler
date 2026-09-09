// DOGS Sampler — dev server launcher (cross-platform, `node start.js`).
// Spawns `vite --host --port 5173` so the dev server inherits this terminal.
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const child = spawn(isWindows ? 'npx.cmd' : 'npx', ['vite', '--host', '--port', '5173'], {
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => process.exit(code ?? 1));
