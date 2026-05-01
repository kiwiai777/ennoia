import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveExportPath } from '../../adapters/chatgpt-export/workspace.js';

describe('ChatGPT workspace', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-workspace-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('resolveExportPath', () => {
    it('should resolve direct conversations.json file path', () => {
      const filePath = path.join(tempDir, 'conversations.json');
      fs.writeFileSync(filePath, '[]');

      const result = resolveExportPath(filePath);
      assert.strictEqual(result, filePath);
    });

    it('should resolve directory containing conversations.json', () => {
      const conversationsPath = path.join(tempDir, 'conversations.json');
      fs.writeFileSync(conversationsPath, '[]');

      const result = resolveExportPath(tempDir);
      assert.strictEqual(result, conversationsPath);
    });

    it('should reject .zip files with helpful error', () => {
      const zipPath = path.join(tempDir, 'export.zip');
      fs.writeFileSync(zipPath, 'fake zip content');

      assert.throws(
        () => resolveExportPath(zipPath),
        {
          message: /ZIP files are not supported.*unzip.*first/i,
        }
      );
    });

    it('should throw error for non-existent path', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist');

      assert.throws(
        () => resolveExportPath(nonExistentPath),
        {
          message: /Path does not exist/,
        }
      );
    });

    it('should throw error for directory without conversations.json', () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir);

      assert.throws(
        () => resolveExportPath(emptyDir),
        {
          message: /Directory does not contain conversations\.json/,
        }
      );
    });

    it('should throw error for empty path', () => {
      assert.throws(
        () => resolveExportPath(''),
        {
          message: /ChatGPT export path is required.*--workspace/,
        }
      );
    });

    it('should resolve relative paths', () => {
      const conversationsPath = path.join(tempDir, 'conversations.json');
      fs.writeFileSync(conversationsPath, '[]');

      const relativePath = path.relative(process.cwd(), conversationsPath);
      const result = resolveExportPath(relativePath);
      assert.strictEqual(result, conversationsPath);
    });

    it('should handle nested directory structure', () => {
      const nestedDir = path.join(tempDir, 'export', 'data');
      fs.mkdirSync(nestedDir, { recursive: true });
      const conversationsPath = path.join(nestedDir, 'conversations.json');
      fs.writeFileSync(conversationsPath, '[]');

      const result = resolveExportPath(nestedDir);
      assert.strictEqual(result, conversationsPath);
    });
  });
});
