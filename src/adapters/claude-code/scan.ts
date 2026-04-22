import fs from 'node:fs';
import path from 'node:path';
import type { ContentBlock, ExtractionHint } from '../../core/extraction/types.js';

// Budgets and limits
const MAX_FILE_SIZE = 100 * 1024; // 100KB per file
const TOTAL_BUDGET = 500 * 1024;  // 500KB total budget
const MAX_CLAUDE_SUBDIR_FILES = 20;

const PACKAGE_JSON_WHITELIST = new Set(['name', 'description', 'dependencies', 'devDependencies', 'engines', 'scripts']);

function filterPackageJson(raw: string, filePath: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[scanWorkspace] 跳过文件：package.json 解析失败 - ${filePath}`);
    return null;
  }
  const filtered: Record<string, unknown> = {};
  for (const key of PACKAGE_JSON_WHITELIST) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      filtered[key] = parsed[key];
    }
  }
  return JSON.stringify(filtered);
}

function isUtf8(buffer: Buffer): boolean {
  // Simple heuristic for checking if buffer is likely UTF-8
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === 0x00) return false; // NUL byte -> likely binary
  }
  return true;
}

function tryReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;

    if (stat.size > MAX_FILE_SIZE) {
      console.warn(`[scanWorkspace] 跳过文件：文件大小超出限制 (${stat.size} bytes > 100KB) - ${filePath}`);
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    if (!isUtf8(buffer)) {
      console.warn(`[scanWorkspace] 跳过文件：非 UTF-8 编码 - ${filePath}`);
      return null;
    }

    return buffer.toString('utf-8');
  } catch (err) {
    // Fail-soft on reading errors
    return null;
  }
}

export function scanWorkspace(rootPath: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let currentTotalSize = 0;
  let budgetExhausted = false;

  function addBlock(filePath: string, kind: ContentBlock['kind'], hint?: ExtractionHint) {
    if (budgetExhausted || currentTotalSize >= TOTAL_BUDGET) {
      return;
    }

    let content = tryReadFile(filePath);
    if (!content) return;

    if (hint === 'package-manifest') {
      const filtered = filterPackageJson(content, filePath);
      if (filtered === null) return;
      content = filtered;
    }

    if (currentTotalSize + content.length > TOTAL_BUDGET) {
      console.warn(`[scanWorkspace] 总预算超出限制 (${TOTAL_BUDGET} bytes / 500KB)，停止扫描。已扫描：${currentTotalSize} bytes，当前文件：${filePath}`);
      budgetExhausted = true;
      return;
    }

    currentTotalSize += content.length;
    // Store relative path to workspace root
    const relPath = path.relative(rootPath, filePath);
    blocks.push({
      path: relPath,
      content,
      kind,
      hint
    });
  }

  try {
    if (!fs.existsSync(rootPath)) return blocks;
    const stat = fs.statSync(rootPath);
    if (!stat.isDirectory()) return blocks;
  } catch (err) {
    return blocks; // Fail-soft if rootPath issues
  }

  // 1. package.json
  const packageJsonPath = path.join(rootPath, 'package.json');
  addBlock(packageJsonPath, 'json', 'package-manifest');

  // 2. README.md
  const readmePath = path.join(rootPath, 'README.md');
  addBlock(readmePath, 'markdown', 'readme');

  // 3. CLAUDE.md
  const claudeMdPath = path.join(rootPath, 'CLAUDE.md');
  addBlock(claudeMdPath, 'markdown', 'plain');

  // 4. .claude/agents/*.md
  const agentsDir = path.join(rootPath, '.claude', 'agents');
  if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
    try {
      const files = fs.readdirSync(agentsDir, { withFileTypes: true });
      let agentCount = 0;
      for (const file of files) {
        if (budgetExhausted) break;
        if (!file.isFile() || !file.name.toLowerCase().endsWith('.md')) continue;

        if (agentCount >= MAX_CLAUDE_SUBDIR_FILES) {
          console.warn(`[scanWorkspace] 达到 .claude/agents 目录数量限制 (${MAX_CLAUDE_SUBDIR_FILES})：截断剩余文件`);
          break;
        }

        addBlock(path.join(agentsDir, file.name), 'markdown', 'agent-def');
        agentCount++;
      }
    } catch (err) {
      // Fail-soft
    }
  }

  // 5. .claude/skills/*.md
  const skillsDir = path.join(rootPath, '.claude', 'skills');
  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    try {
      const files = fs.readdirSync(skillsDir, { withFileTypes: true });
      let skillCount = 0;
      for (const file of files) {
        if (budgetExhausted) break;
        if (!file.isFile() || !file.name.toLowerCase().endsWith('.md')) continue;

        if (skillCount >= MAX_CLAUDE_SUBDIR_FILES) {
          console.warn(`[scanWorkspace] 达到 .claude/skills 目录数量限制 (${MAX_CLAUDE_SUBDIR_FILES})：截断剩余文件`);
          break;
        }

        addBlock(path.join(skillsDir, file.name), 'markdown', 'skill-def');
        skillCount++;
      }
    } catch (err) {
      // Fail-soft
    }
  }

  return blocks;
}