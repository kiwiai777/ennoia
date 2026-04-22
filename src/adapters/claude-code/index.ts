// Claude Code Workspace Adapter
//
// CT-0007：第一个真实 agent adapter，从 Claude Code workspace 读取稳定文件。
// CT-0022-01：深化抓取能力，接入通用 extraction 层。

import fs from 'node:fs';
import path from 'node:path';
import type { SourceAdapter, SourceBlock } from '../base.js';
import type { SourceDescriptor } from '../../core/source/types.js';
import type { ExtractionCandidate } from '../../core/extraction/types.js';
import { scanWorkspace } from './scan.js';
import { extract } from '../../core/extraction/index.js';

export const claudeCodeAdapter: SourceAdapter = {
  id: 'claude-code',

  canHandle(descriptor: SourceDescriptor): boolean {
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

    // CT-0022-01: Update load to use scanWorkspace but convert to SourceBlock to preserve backwards compat
    // For older usage which might just expect text and path
    const scannedBlocks = scanWorkspace(workspacePath);
    for (const b of scannedBlocks) {
      blocks.push({
        text: b.content,
        source_path: path.join(workspacePath, b.path)
      });
    }

    if (blocks.length === 0) {
      throw new Error(
        `workspace 中未找到支持的文件：${workspacePath}`
      );
    }

    return blocks;
  },
};

// CT-0022-01: 集成入口点，为 CT-0022-02 提供直接支持
export async function extractFromClaudeCodeWorkspace(rootPath: string): Promise<ExtractionCandidate[]> {
  const contentBlocks = scanWorkspace(rootPath);
  
  return extract({
    sourceId: 'claude-code',
    sourceDescriptor: {
      kind: 'directory',
      path: rootPath,
      adapter: 'claude-code'
    },
    contentBlocks
  });
}
