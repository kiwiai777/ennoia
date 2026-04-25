
import { spawnSync } from 'child_process';
const result = spawnSync('npx', ['tsx', 'src/index.ts', 'inject', '--target', 'openclaw', '--dry-run'], { encoding: 'utf8' });
console.log('STATUS:', result.status);
console.log('STDOUT:', result.stdout);
console.log('STDERR:', result.stderr);
