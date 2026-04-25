const { spawnSync } = require('child_process');

const r = spawnSync('npm', ['test', 'src/core/runtime/__tests__/observation-inject.test.ts'], { encoding: 'utf8' });
console.log(r.stdout);
