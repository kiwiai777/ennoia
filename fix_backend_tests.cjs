const fs = require('fs');
const path = require('path');

const testFiles = [
  'src/__tests__/backends/config.test.ts',
  'src/__tests__/backends/detect.test.ts',
  'src/__tests__/backends/factory.test.ts',
  'src/__tests__/backends/llm-ollama.test.ts',
  'src/__tests__/backends/llm-openai-compat.test.ts',
  'src/__tests__/backends/llm-anthropic.test.ts',
  'src/__tests__/backends/embedding-ollama.test.ts',
  'src/__tests__/backends/embedding-openai-compat.test.ts',
];

testFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Replace imports
  content = content.replace(
    /import { describe, it, expect, jest, beforeEach(, afterEach)? } from '@jest\/globals';/g,
    (match, afterEach) => {
      if (afterEach) {
        return "import { describe, it, beforeEach, afterEach, mock } from 'node:test';\nimport assert from 'node:assert/strict';";
      }
      return "import { describe, it, beforeEach, mock } from 'node:test';\nimport assert from 'node:assert/strict';";
    }
  );

  content = content.replace(
    /import { describe, it, expect, beforeEach } from '@jest\/globals';/g,
    "import { describe, it, beforeEach, mock } from 'node:test';\nimport assert from 'node:assert/strict';"
  );

  content = content.replace(
    /import { describe, it, expect, jest, beforeEach } from '@jest\/globals';/g,
    "import { describe, it, beforeEach, mock } from 'node:test';\nimport assert from 'node:assert/strict';"
  );

  // Replace jest.fn() with mock.fn()
  content = content.replace(/jest\.fn\(\)/g, 'mock.fn()');
  content = content.replace(/jest\.Mock/g, 'any');

  // Replace expect assertions
  content = content.replace(/expect\(([^)]+)\)\.toBe\(([^)]+)\)/g, 'assert.strictEqual($1, $2)');
  content = content.replace(/expect\(([^)]+)\)\.toEqual\(([^)]+)\)/g, 'assert.deepStrictEqual($1, $2)');
  content = content.replace(/expect\(([^)]+)\)\.toHaveLength\(([^)]+)\)/g, 'assert.strictEqual($1.length, $2)');
  content = content.replace(/expect\(([^)]+)\)\.toBeUndefined\(\)/g, 'assert.strictEqual($1, undefined)');
  content = content.replace(/expect\(([^)]+)\)\.toContain\(([^)]+)\)/g, 'assert.ok($1.includes($2))');
  content = content.replace(/expect\(([^)]+)\)\.toBeCloseTo\(([^)]+), ([^)]+)\)/g, 'assert.ok(Math.abs($1 - $2) < Math.pow(10, -$3))');

  // Replace expect().rejects.toThrow()
  content = content.replace(/await expect\(([^)]+)\)\.rejects\.toThrow\(([^)]+)\)/g, 'await assert.rejects($1, $2)');

  // Replace expect().toHaveBeenCalledWith()
  content = content.replace(/expect\(global\.fetch\)\.toHaveBeenCalledWith\(/g, 'assert.ok((global.fetch as any).mock.calls.some((call: any) => call.arguments[0] ===');

  // Fix mock calls access
  content = content.replace(/\(global\.fetch as jest\.Mock\)\.mock\.calls\[0\]\[1\]\.body/g, '(global.fetch as any).mock.calls[0].arguments[1].body');
  content = content.replace(/\(global\.fetch as jest\.Mock\)\.mock\.calls\[0\]\[1\]/g, '(global.fetch as any).mock.calls[0].arguments[1]');

  // Replace beforeEach mock setup
  content = content.replace(/global\.fetch = jest\.fn\(\) as any;/g, 'global.fetch = mock.fn() as any;');

  // Replace mockResolvedValueOnce
  content = content.replace(/\(global\.fetch as jest\.Mock\)\.mockResolvedValueOnce/g, '(global.fetch as any).mock.mockImplementationOnce(async () =>');
  content = content.replace(/\(global\.fetch as jest\.Mock\)\.mockRejectedValueOnce/g, '(global.fetch as any).mock.mockImplementationOnce(async () => { throw');
  content = content.replace(/\(global\.fetch as jest\.Mock\)\.mockImplementationOnce/g, '(global.fetch as any).mock.mockImplementationOnce');

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Fixed: ${file}`);
});

console.log('All test files fixed!');
