const fs = require('fs');

let content1 = fs.readFileSync('src/core/runtime/__tests__/observation.test.ts', 'utf8');
content1 = content1.replace(/await withTmpHome\(async \(\) => \{/g, 'await withTmpHome(async () => {');
content1 = content1.replace(/await withTmpHome\(\(\) => \{/g, 'await withTmpHome(async () => {');
fs.writeFileSync('src/core/runtime/__tests__/observation.test.ts', content1, 'utf8');

let content2 = fs.readFileSync('src/core/runtime/__tests__/selection.test.ts', 'utf8');
content2 = content2.replace(/async function runInjectCommand\(args: string\[\]\): RunResult/g, 'async function runInjectCommand(args: string[]): Promise<RunResult>');
fs.writeFileSync('src/core/runtime/__tests__/selection.test.ts', content2, 'utf8');
