const fs = require('fs');

const files = [
  'src/core/runtime/__tests__/observation-inject.test.ts',
  'src/core/runtime/__tests__/observation.test.ts',
  'src/core/runtime/__tests__/selection.test.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/withTmpHome\(\(\) => \{/g, 'await withTmpHome(async () => {');
  content = content.replace(/function withTmpHome<T>\(fn: \(tmpHome: string\) => T\): T {/g, 'async function withTmpHome<T>(fn: (tmpHome: string) => Promise<T>): Promise<T> {');
  content = content.replace(/return fn\(tmpHome\);/g, 'return await fn(tmpHome);');
  fs.writeFileSync(file, content, 'utf8');
}
