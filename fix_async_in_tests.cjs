const fs = require('fs');

const files = [
  'src/core/runtime/__tests__/observation-inject.test.ts',
  'src/core/runtime/__tests__/observation.test.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/function runCmd\(fn: \(\) => void\): RunResult {/g, 'async function runCmd(fn: () => void | Promise<void>): Promise<RunResult> {');
  content = content.replace(/fn\(\);/g, 'await fn();');
  content = content.replace(/runCmd\(\(\) => /g, 'await runCmd(async () => ');
  content = content.replace(/const r = await runCmd\(\(\) => /g, 'const r = await runCmd(async () => ');
  fs.writeFileSync(file, content, 'utf8');
}
