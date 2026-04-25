const fs = require('fs');

let content = fs.readFileSync('src/adapters/openclaw/render.ts', 'utf8');
content = content.replace(
  "const content = item.label;",
  "const content = item.label.replace(/^[-*]\\s+/, '').trim();"
);

fs.writeFileSync('src/adapters/openclaw/render.ts', content, 'utf8');

let testContent = fs.readFileSync('src/__tests__/adapters/openclaw-render.test.ts', 'utf8');
const additionalTests = `
test('openclaw render - trim prefix (dash)', () => {
  const items: UserModelItem[] = [{ kind: 'goal', label: '- 统一 dedupe 逻辑' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '用户的目标是 统一 dedupe 逻辑。');
});

test('openclaw render - trim prefix (asterisk)', () => {
  const items: UserModelItem[] = [{ kind: 'goal', label: '* prefer TypeScript' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, "The user's goal is to prefer TypeScript.");
});
`;
testContent += additionalTests;
fs.writeFileSync('src/__tests__/adapters/openclaw-render.test.ts', testContent, 'utf8');
