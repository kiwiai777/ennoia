// Generic Source Adapter
// 支持 .txt / .md / .json；支持目录递归。
// 每块输出均带 source_path，保留文件级来源信息。
//
// CT-0006：改为基于 SourceDescriptor 工作，而不是直接接 raw path。

import fs from 'node:fs';
import path from 'node:path';
import type { SourceAdapter, SourceBlock } from './base.js';
import type { SourceDescriptor } from '../core/source/types.js';

const SUPPORTED_EXT = new Set(['.txt', '.md', '.json']);

function isSupportedFile(file: string): boolean {
  return SUPPORTED_EXT.has(path.extname(file).toLowerCase());
}

// 把 JSON 原文直接作为文本块返回（保留缩进，便于 LLM 阅读）。
// 非 JSON 文件直接返回原文。
function readFileAsText(file: string): string {
  const raw = fs.readFileSync(file, 'utf-8');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // 解析失败也不抛——按原文处理，交给下游 extractor 自己决定
      return raw;
    }
  }
  return raw;
}

// 递归收集目录下所有受支持的文件。跳过隐藏目录（.git / node_modules 这类）。
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.isFile() && isSupportedFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export const genericAdapter: SourceAdapter = {
  id: 'generic',

  canHandle(descriptor: SourceDescriptor): boolean {
    // 只处理 file / directory 类型
    if (descriptor.kind !== 'file' && descriptor.kind !== 'directory') {
      return false;
    }

    const p = descriptor.path;
    if (!fs.existsSync(p)) return false;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) return true;
    if (stat.isFile()) return isSupportedFile(p);
    return false;
  },

  async load(descriptor: SourceDescriptor): Promise<SourceBlock[]> {
    const p = descriptor.path;

    if (!fs.existsSync(p)) {
      throw new Error(`路径不存在：${p}`);
    }
    const stat = fs.statSync(p);

    if (stat.isFile()) {
      if (!isSupportedFile(p)) {
        throw new Error(`不支持的文件类型：${p}（仅支持 .txt / .md / .json）`);
      }
      return [{ text: readFileAsText(p), source_path: p }];
    }

    if (stat.isDirectory()) {
      const files = collectFiles(p);
      if (files.length === 0) {
        throw new Error(`目录中未找到 .txt / .md / .json 文件：${p}`);
      }
      // 每个文件独立一块，保留文件级 source_path。
      return files.map((f) => ({
        text: readFileAsText(f),
        source_path: f,
      }));
    }

    throw new Error(`路径既不是文件也不是目录：${p}`);
  },
};
