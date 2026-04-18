#!/usr/bin/env node
// Cortex CLI 入口
// 命令：
//   cortex save "<文本>"   把一段文本写入 user model（当前默认追加到 goals）
//   cortex context         从 user model 生成可用于 prompt 的中文上下文
//
// 设计原则：
//   - 只用 process.argv，不引入 CLI 框架
//   - 不做自动分类，save 一律写进 goals（CT-0002 限制）
//   - 文件不存在时自动初始化

import { randomUUID } from 'node:crypto';

import {
  loadUserModel,
  updateUserModel,
  getUserModelPath,
} from './core/user-model/storage.js';
import {
  selectRuntimeContext,
  renderPromptContext,
} from './core/runtime/context.js';
import type { Goal } from './core/user-model/types.js';

function usage(): void {
  console.log('Cortex CLI');
  console.log('');
  console.log('用法：');
  console.log('  cortex save "<一段文本>"   把文本写入 user model（goals）');
  console.log('  cortex context             输出当前 user context');
  console.log('');
  console.log(`存储位置：${getUserModelPath()}`);
}

function cmdSave(text: string): void {
  const trimmed = text.trim();
  if (trimmed === '') {
    console.error('错误：save 需要一段文本。示例：cortex save "避免单点依赖"');
    process.exit(1);
  }

  const now = new Date().toISOString();
  const goal: Goal = {
    id: `goal_${randomUUID()}`,
    label: trimmed,
    scope: 'global',
    source: 'cli:save',
    created_at: now,
    updated_at: now,
  };

  // 走统一写入口：load → mutate → save 都在 storage 层完成
  updateUserModel((model) => {
    model.goals.push(goal);
    model.meta.last_updated = now;
    if (!model.meta.sources.includes('cli:save')) {
      model.meta.sources.push('cli:save');
    }
  });

  console.log('已保存到 user model（goals）：');
  console.log(`  - ${goal.label}`);
}

function cmdContext(): void {
  const model = loadUserModel();
  const ctx = selectRuntimeContext(model);
  console.log(renderPromptContext(ctx));
}

function main(): void {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'save':
      cmdSave(rest.join(' '));
      break;
    case 'context':
      cmdContext();
      break;
    case undefined:
    case '-h':
    case '--help':
      usage();
      break;
    default:
      console.error(`未知命令：${cmd}`);
      usage();
      process.exit(1);
  }
}

// 顶层错误处理：parse / IO 异常直接打印中文消息，不抛堆栈给终端用户。
// 非预期错误仍带堆栈，方便排查。
try {
  main();
} catch (err) {
  if (err instanceof Error) {
    console.error(`错误：${err.message}`);
  } else {
    console.error('错误：未知异常', err);
  }
  process.exit(1);
}
