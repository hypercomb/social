const { spawn } = require('child_process');
const path = require('path');

const ngCli = path.join('C:', 'Projects', 'hypercomb', 'social', 'src', 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const cwd = path.join('C:', 'Projects', 'hypercomb', 'social', 'src', 'hypercomb-web');

const child = spawn(process.execPath, [ngCli, 'serve', '--configuration', 'production', '--port', '4203'], {
  cwd,
  stdio: 'inherit',
  env: { ...process.env }
});

child.on('exit', (code) => process.exit(code));
