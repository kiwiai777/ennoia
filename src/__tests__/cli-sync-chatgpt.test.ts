import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('CLI sync chatgpt-export', () => {
  const cliPath = path.join(process.cwd(), 'dist/index.js');
  const fixturePath = path.join(
    process.cwd(),
    'src/__tests__/fixtures/chatgpt-conversations.json'
  );

  it('should require --workspace parameter', () => {
    const result = spawnSync('node', [cliPath, 'sync', '--from', 'chatgpt-export'], {
      encoding: 'utf-8',
    });

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /chatgpt-export.*--workspace/);
  });

  it('should accept --workspace with conversations.json file', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2020-01-01',
        '--min-length',
        '10',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /ChatGPT export:.*conversations total/);
  });

  it('should accept --workspace with directory containing conversations.json', () => {
    const fixtureDir = path.dirname(fixturePath);
    // Create a temp directory with conversations.json for this test
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-test-'));
    const convPath = path.join(tempDir, 'conversations.json');
    fs.copyFileSync(fixturePath, convPath);

    try {
      const result = spawnSync(
        'node',
        [
          cliPath,
          'sync',
          '--from',
          'chatgpt-export',
          '--workspace',
          tempDir,
          '--since',
          '2020-01-01',
          '--min-length',
          '10',
          '--dry-run',
        ],
        { encoding: 'utf-8' }
      );

      assert.strictEqual(result.status, 0);
      assert.match(result.stderr, /ChatGPT export:.*conversations total/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should reject .zip files', () => {
    const result = spawnSync(
      'node',
      [cliPath, 'sync', '--from', 'chatgpt-export', '--workspace', '/tmp/export.zip', '--dry-run'],
      { encoding: 'utf-8' }
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /ZIP files are not supported.*unzip/);
  });

  it('should accept --since parameter', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2020-01-01',
        '--min-length',
        '10',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /ChatGPT export:.*conversations total/);
  });

  it('should accept --min-length parameter', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2020-01-01',
        '--min-length',
        '100',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /ChatGPT export:.*conversations total/);
  });

  it('should accept --max-conversations parameter', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2020-01-01',
        '--min-length',
        '10',
        '--max-conversations',
        '10',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /ChatGPT export:.*conversations total/);
  });

  it('should filter conversations by time', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2025-01-01',
        '--min-length',
        '10',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    // Should skip conv-1 (2024) and conv-2 (2020), only process conv-3 (2026)
    assert.match(result.stderr, /skipped \(time\)/);
  });

  it('should filter conversations by length', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2020-01-01',
        '--min-length',
        '1000',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    // Should skip short conversations
    assert.match(result.stderr, /skipped \(length\)/);
  });

  it('should report filtering statistics', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'sync',
        '--from',
        'chatgpt-export',
        '--workspace',
        fixturePath,
        '--since',
        '2020-01-01',
        '--min-length',
        '10',
        '--dry-run',
      ],
      { encoding: 'utf-8' }
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /conversations total/);
    assert.match(result.stderr, /skipped \(time\)/);
    assert.match(result.stderr, /skipped \(length\)/);
    assert.match(result.stderr, /processed/);
  });
});
