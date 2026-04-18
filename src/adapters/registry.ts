// Adapter Registry — 统一管理与调度 Source Adapter
//
// CT-0006 引入 adapter registry，使 import 不再直接硬编码 generic adapter，
// 而是通过 descriptor + registry dispatch 选择合适的 adapter。
//
// 当前注册：
//   - generic adapter（支持 file / directory）
//   - claude-code adapter（Claude Code workspace，CT-0007）
//
// 未来扩展方向：
//   - openclaw adapter（OpenClaw workspace）
//   - hermes adapter（Hermes 事件流）
//   - chat-export adapter（ChatGPT / Claude 导出文件）

import type { SourceAdapter } from './base.js';
import type { SourceDescriptor } from '../core/source/types.js';
import { genericAdapter } from './generic.js';
import { claudeCodeAdapter } from './claude-code/index.js';

// 全局 adapter 注册表
const registry = new Map<string, SourceAdapter>();

// 注册一个 adapter
export function registerAdapter(adapter: SourceAdapter): void {
  if (registry.has(adapter.id)) {
    throw new Error(`Adapter 已注册：${adapter.id}`);
  }
  registry.set(adapter.id, adapter);
}

// 根据 descriptor 选择合适的 adapter
//
// 选择逻辑：
//   1. 若 descriptor.adapter 显式指定，优先使用该 adapter（若不存在则抛错）
//   2. 否则遍历所有已注册 adapter，返回第一个 canHandle 的 adapter
//   3. 若无 adapter 能处理，抛错
export function getAdapterForSource(
  descriptor: SourceDescriptor
): SourceAdapter {
  // 显式指定 adapter
  if (descriptor.adapter) {
    const adapter = registry.get(descriptor.adapter);
    if (!adapter) {
      throw new Error(
        `指定的 adapter 不存在：${descriptor.adapter}（可用：${listAvailableAdapters().join(', ')}）`
      );
    }
    if (!adapter.canHandle(descriptor)) {
      throw new Error(
        `Adapter ${descriptor.adapter} 无法处理该来源：${JSON.stringify(descriptor)}`
      );
    }
    return adapter;
  }

  // 自动选择
  for (const adapter of registry.values()) {
    if (adapter.canHandle(descriptor)) {
      return adapter;
    }
  }

  throw new Error(
    `无 adapter 能处理该来源：${JSON.stringify(descriptor)}（可用：${listAvailableAdapters().join(', ')}）`
  );
}

// 列出所有已注册的 adapter id
export function listAvailableAdapters(): string[] {
  return Array.from(registry.keys());
}

// 初始化：注册默认 adapter
registerAdapter(genericAdapter);
registerAdapter(claudeCodeAdapter);
