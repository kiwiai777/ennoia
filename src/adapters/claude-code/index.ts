// Claude Code Workspace Adapter
//
// CT-0007：第一个真实 agent adapter，从 Claude Code workspace 读取稳定文件。
//
// 设计原则：
//   - 显式优于隐式：只接受显式 --adapter claude-code 调用
//   - 稳定文件优于内部状态：只读取用户可理解、可维护的文件
//   - workspace source，而不是 runtime deep integration
//
// 读取策略（方案 A，更稳）：
//   - CLAUDE.md（若存在）
//   - README.md（若存在）
//   - 根目录下少量 .md 文件（上限 5 个，排除 CLAUDE.md / README.md）
//
// 不读取：
//   - .claude/ 私有目录
//   - 源码文件
//   - 不稳定缓存
//   - 全部历史会话

import fs from 'node:fs';
import path from 'node:path';
import type { SourceAdapter, SourceBlock } from '../base.js';
import type { SourceDescriptor } from '../../core/source/types.js';

// 根目录 .md 文件数量上限（排除 CLAUDE.md / README.md）
const MAX_ROOT_MD_FILES = 5;

// 单文件大小上限（1MB）
const MAX_FILE_SIZE = 1024 * 1024;

// 优先读取的文件（按顺序）
const PRIORITY_FILES = ['CLAUDE.md', 'README.md'];

function isMarkdownFile(file: string): boolean {
  return path.extname(file).toLowerCase() === '.md';
}

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;

  // 检查文件大小
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`跳过过大文件：${filePath}（${stat.size} bytes > ${MAX_FILE_SIZE} bytes）`);
    return null;
  }

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`读取文件失败：${filePath}`, err);
    return null;
  }
}

// 收集根目录下的 .md 文件（排除优先文件）
function collectRootMarkdownFiles(dir: string): string[] {
  const out: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // 只处理文件，不递归目录
      if (!entry.isFile()) continue;

      // 只处理 .md 文件
      if (!isMarkdownFile(entry.name)) continue;

      // 排除优先文件（已单独处理）
      if (PRIORITY_FILES.includes(entry.name)) continue;

      out.push(path.join(dir, entry.name));

      // 达到上限则停止
      if (out.length >= MAX_ROOT_MD_FILES) break;
    }
  } catch (err) {
    console.warn(`读取目录失败：${dir}`, err);
  }

  return out;
}

export const claudeCodeAdapter: SourceAdapter = {
  id: 'claude-code',

  canHandle(descriptor: SourceDescriptor): boolean {
    // 只接受显式指定 adapter 的 directory descriptor
    if (descriptor.adapter !== 'claude-code') return false;
    if (descriptor.kind !== 'directory') return false;

    const p = descriptor.path;
    if (!fs.existsSync(p)) return false;

    const stat = fs.statSync(p);
    return stat.isDirectory();
  },

  async load(descriptor: SourceDescriptor): Promise<SourceBlock[]> {
    const workspacePath = descriptor.path;

    if (!fs.existsSync(workspacePath)) {
      throw new Error(`workspace 路径不存在：${workspacePath}`);
    }

    const stat = fs.statSync(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error(`workspace 路径不是目录：${workspacePath}`);
    }

    const blocks: SourceBlock[] = [];

    // 1. 读取优先文件（CLAUDE.md / README.md）
    for (const filename of PRIORITY_FILES) {
      const filePath = path.join(workspacePath, filename);
      const content = readFileIfExists(filePath);

      if (content !== null) {
        blocks.push({
          text: content,
          source_path: filePath,
        });
      }
    }

    // 2. 读取根目录下其他 .md 文件（上限 5 个）
    const rootMdFiles = collectRootMarkdownFiles(workspacePath);
    for (const filePath of rootMdFiles) {
      const content = readFileIfExists(filePath);

      if (content !== null) {
        blocks.push({
          text: content,
          source_path: filePath,
        });
      }
    }

    // 如果没有读取到任何文件，抛错
    if (blocks.length === 0) {
      throw new Error(
        `workspace 中未找到支持的文件：${workspacePath}\n` +
        `（支持：CLAUDE.md / README.md / 根目录下 .md 文件）`
      );
    }

    return blocks;
  },
};
