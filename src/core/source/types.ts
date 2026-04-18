// Source Descriptor — 统一描述 Cortex 的输入来源
//
// CT-0006 引入 Source Descriptor 作为来源层的统一抽象，使 import 不再
// 直接硬编码 adapter，而是通过 descriptor + registry dispatch。
//
// 当前覆盖：
//   - file / directory（对应当前 import 能处理的来源）
//
// 未来扩展方向（本轮不实现）：
//   - agent_workspace（Claude Code / OpenClaw workspace）
//   - agent_transcript（Claude Code / chat transcript）
//   - chat_export（ChatGPT / Claude 导出文件）
//   - event_stream（Hermes / OpenClaw 事件流）

import fs from 'node:fs';

// 当前支持的来源类型
export type SourceKind = 'file' | 'directory';

// 来源描述符
//
// 统一描述 import 的输入来源，供 adapter registry 选择合适的 adapter。
export interface SourceDescriptor {
  // 来源类型
  kind: SourceKind;

  // 来源路径（当前为文件系统路径；未来可能扩展为 URL / workspace id 等）
  path: string;

  // 可选：显式指定 adapter id（当前不使用，预留给未来 --adapter 参数）
  adapter?: string;

  // 可选：额外元数据（预留给未来扩展，如 workspace context / agent name 等）
  metadata?: Record<string, unknown>;
}

// 从 CLI 参数构造 SourceDescriptor 的辅助函数
//
// 当前逻辑：
//   - 路径存在且为目录 → kind = 'directory'
//   - 路径存在且为文件 → kind = 'file'
//   - 路径不存在 → 抛错
//
// 未来可扩展为识别 URL / workspace id 等。
export function createDescriptorFromPath(p: string): SourceDescriptor {
  if (!fs.existsSync(p)) {
    throw new Error(`路径不存在：${p}`);
  }

  const stat = fs.statSync(p);

  if (stat.isDirectory()) {
    return { kind: 'directory', path: p };
  }

  if (stat.isFile()) {
    return { kind: 'file', path: p };
  }

  throw new Error(`路径既不是文件也不是目录：${p}`);
}
