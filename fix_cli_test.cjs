const fs = require('fs');

let testContent = fs.readFileSync('src/__tests__/cli-inject-openclaw.test.ts', 'utf8');

// Replace mock with actual execution using the TSX loader pattern from F3
testContent = testContent.replace(/import { injectToOpenClaw } from '\.\.\/adapters\/openclaw\/index\.js';[\s\S]*?import \* as storage from '\.\.\/core\/user-model\/storage\.js';/m, `import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TSX_LOADER = require.resolve('tsx/esm');`);

// Update dry-run test
testContent = testContent.replace(/  \/\/ Mock loadUserModel[\s\S]*?assert\.match\(stdout, \/\\\[dry-run\\] 未写入\/\);/m, `  // Run CLI
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, 'src/index.ts', 'inject', '--target', 'openclaw', '--dry-run', '--workspace', dir],
    {
      env: { ...process.env, HOME: dir },
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
    }
  );

  const stdout = result.stdout || '';
  
  assert.equal(result.status, 0, \`Process exited with \${result.status}. Stderr: \${result.stderr}\`);
  assert.match(stdout, /Cortex → OpenClaw \\[dry-run\\]/);
  assert.match(stdout, /注入路径/);
  assert.match(stdout, /--- 注入内容预览 ---/);
  assert.match(stdout, /The user prefers TypeScript over JavaScript for all projects./);
  assert.match(stdout, /The user's goal is to learn Rust this year./);
  assert.match(stdout, /\\[dry-run\\] 未写入/);`);

// Update real run test  
testContent = testContent.replace(/  \/\/ Mock loadUserModel[\s\S]*?assert\.match\(stdout, \/systemctl --user restart openclaw-gateway\/\);/m, `  // Run CLI
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, 'src/index.ts', 'inject', '--target', 'openclaw', '--workspace', dir],
    {
      env: { ...process.env, HOME: dir },
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
    }
  );

  const stdout = result.stdout || '';

  assert.equal(result.status, 0, \`Process exited with \${result.status}. Stderr: \${result.stderr}\`);
  assert.match(stdout, /✓ 写入完成。/);
  assert.match(stdout, /systemctl --user restart openclaw-gateway/);`);

fs.writeFileSync('src/__tests__/cli-inject-openclaw.test.ts', testContent, 'utf8');
