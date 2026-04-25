const fs = require('fs');

const files = [
  'src/core/runtime/__tests__/observation-inject.test.ts',
  'src/core/runtime/__tests__/observation.test.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/cmdInject\(args\)/g, 'await cmdInject(args)');
  content = content.replace(/function runInjectCommand/g, 'async function runInjectCommand');
  content = content.replace(/const r = runInjectCommand/g, 'const r = await runInjectCommand');
  content = content.replace(/it\('([^']+)', \(\) => \{/g, "it('$1', async () => {");
  fs.writeFileSync(file, content, 'utf8');
}
