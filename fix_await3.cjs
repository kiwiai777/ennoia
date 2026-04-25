const fs = require('fs');

let content1 = fs.readFileSync('src/core/runtime/__tests__/observation.test.ts', 'utf8');
content1 = content1.replace(/withTmpHome\(\(tmpHome\) => \{/g, 'await withTmpHome(async (tmpHome) => {');
fs.writeFileSync('src/core/runtime/__tests__/observation.test.ts', content1, 'utf8');

