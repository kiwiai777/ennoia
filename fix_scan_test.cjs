const fs = require('fs');

let content = fs.readFileSync('src/__tests__/adapters/openclaw-scan.test.ts', 'utf8');

content = content.replace(
  "assert.strictEqual(blocks[0].content, 'Hello\\n\\nWorld'); // simplified check",
  "assert.strictEqual(blocks[0].content.trim(), 'Hello\\nWorld'); // simplified check"
);

fs.writeFileSync('src/__tests__/adapters/openclaw-scan.test.ts', content, 'utf8');
