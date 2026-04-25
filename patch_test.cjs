const fs = require('fs');
let content = fs.readFileSync('src/__tests__/adapters/openclaw-inject.test.ts', 'utf8');
content = content.replace(
  "fs.writeFile = async (file: string, data: any, options: any) => {",
  "// @ts-ignore\n  fs.writeFile = async (file: string, data: any, options: any) => {"
);
content = content.replace(
  "fs.writeFile = originalWriteFile;",
  "// @ts-ignore\n  fs.writeFile = originalWriteFile;"
);
fs.writeFileSync('src/__tests__/adapters/openclaw-inject.test.ts', content, 'utf8');
