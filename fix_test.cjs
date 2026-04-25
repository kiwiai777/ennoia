const fs = require('fs');

// Create a mock script to run and log the outputs of the CLI wrapper directly
const content = `
import { spawnSync } from 'child_process';
const result = spawnSync('npx', ['tsx', 'src/index.ts', 'inject', '--target', 'openclaw', '--dry-run'], { encoding: 'utf8' });
console.log('STATUS:', result.status);
console.log('STDOUT:', result.stdout);
console.log('STDERR:', result.stderr);
`;
fs.writeFileSync('run_cli.js', content);
