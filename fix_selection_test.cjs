const fs = require('fs');

let content = fs.readFileSync('src/core/runtime/__tests__/selection.test.ts', 'utf8');
content = content.replace(/cmdInject\(args\)/g, 'await cmdInject(args)');
content = content.replace(/function runInjectCommand/g, 'async function runInjectCommand');
content = content.replace(/const r = runInjectCommand/g, 'const r = await runInjectCommand');
content = content.replace(/it\('([^']+)', \(\) => \{/g, "it('$1', async () => {");
fs.writeFileSync('src/core/runtime/__tests__/selection.test.ts', content, 'utf8');
