#!/usr/bin/env node
// Cortex CLI 入口
// 命令：
//   cortex save "<文本>"          写入 user model（goals）
//   cortex context                输出当前 user context
//   cortex import <path> [--llm]  从文件/目录导入，交互选择后写入
//
// 设计原则：
//   - 只用 process.argv，不引入 CLI 框架
//   - CLI 不自己拼装读改写；所有写入走 updateUserModel
//   - LLM 默认不启用；--llm 且存在 OPENAI_API_KEY 时才启用

import { randomUUID } from 'node:crypto';
import readline from 'node:readline/promises';

import {
  loadUserModel,
  updateUserModel,
  getUserModelPath,
} from './core/user-model/storage.js';
import {
  selectRuntimeContext,
  renderPromptContext,
} from './core/runtime/context.js';
import type {
  Goal,
  Constraint,
  Preference,
} from './core/user-model/types.js';

import { genericAdapter } from './adapters/generic.js';
import { basicExtract } from './core/extraction/basic-extractor.js';
import { llmExtract } from './core/extraction/llm-extractor.js';
import type {
  CandidateItem,
  CandidateType,
} from './core/extraction/types.js';

function usage(): void {
  console.log('Cortex CLI');
  console.log('');
  console.log('用法：');
  console.log('  cortex save "<一段文本>"       把文本写入 user model（goals）');
  console.log('  cortex context                 输出当前 user context');
  console.log('  cortex import <path> [--llm]   从文件/目录导入并交互写入');
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

// --- import ---

function printCandidates(items: CandidateItem[]): void {
  console.log('');
  console.log('检测到以下候选：');
  console.log('');
  items.forEach((item, i) => {
    const tag = item.type ? `[${item.type}]` : '[未分类]';
    console.log(`${i + 1}. ${tag} ${item.text}`);
  });
  console.log('');
}

// 解析用户输入：支持 "all" / "none"（或空）/ "1,2,3"
function parseSelection(input: string, total: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'none') return [];
  if (trimmed === 'all') return Array.from({ length: total }, (_, i) => i);

  const picked = new Set<number>();
  for (const part of trimmed.split(/[,\s]+/)) {
    if (!part) continue;
    const n = Number.parseInt(part, 10);
    if (Number.isNaN(n) || n < 1 || n > total) {
      throw new Error(`无效编号：${part}（应为 1 到 ${total} 之间）`);
    }
    picked.add(n - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

async function promptSelection(total: number): Promise<number[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      '选择要加入的项（编号如 "1,2"，或 "all" / "none"）：'
    );
    return parseSelection(answer, total);
  } finally {
    rl.close();
  }
}

// 把候选按 type 分派进 user model 的对应数组；缺 type 默认落 goals。
function writeCandidates(items: CandidateItem[], source: string): void {
  if (items.length === 0) return;
  const now = new Date().toISOString();

  updateUserModel((model) => {
    for (const item of items) {
      const type: CandidateType = item.type ?? 'goal';
      const base = {
        id: `${type}_${randomUUID()}`,
        label: item.text,
        scope: 'global',
        source,
        created_at: now,
        updated_at: now,
      };
      if (type === 'goal') {
        model.goals.push(base as Goal);
      } else if (type === 'constraint') {
        model.constraints.push(base as Constraint);
      } else {
        model.preferences.push(base as Preference);
      }
    }
    model.meta.last_updated = now;
    if (!model.meta.sources.includes(source)) {
      model.meta.sources.push(source);
    }
  });
}

async function cmdImport(args: string[]): Promise<void> {
  const useLlmFlag = args.includes('--llm');
  const path = args.find((a) => !a.startsWith('--'));

  if (!path) {
    console.error('错误：import 需要一个路径。示例：cortex import ./notes.md');
    process.exit(1);
  }

  if (!genericAdapter.canHandle(path)) {
    console.error(
      `错误：generic adapter 无法处理该路径：${path}（支持 .txt / .md / .json 与目录）`
    );
    process.exit(1);
  }

  const blocks = await genericAdapter.load(path);
  console.log(`已读取 ${blocks.length} 个文本块（来自 ${path}）`);

  // LLM 模式仅在 flag + key 同时存在时启用，否则退回 basic
  const llmAvailable = useLlmFlag && Boolean(process.env.OPENAI_API_KEY);
  let candidates: CandidateItem[];
  let source: string;

  if (useLlmFlag && !process.env.OPENAI_API_KEY) {
    console.log('未启用 LLM，使用基础模式（缺少 OPENAI_API_KEY）');
  }

  if (llmAvailable) {
    console.log('使用 LLM 提取候选…');
    candidates = await llmExtract(blocks);
    source = `cli:import:llm:${path}`;
  } else {
    if (!useLlmFlag) {
      console.log('未启用 LLM，使用基础模式');
    }
    candidates = basicExtract(blocks);
    source = `cli:import:basic:${path}`;
  }

  if (candidates.length === 0) {
    console.log('未提取到任何候选，已退出。');
    return;
  }

  printCandidates(candidates);
  const indices = await promptSelection(candidates.length);

  if (indices.length === 0) {
    console.log('未选择任何候选，已退出。');
    return;
  }

  const picked = indices.map((i) => candidates[i]);
  writeCandidates(picked, source);

  console.log('');
  console.log(`已写入 ${picked.length} 条到 user model：`);
  for (const item of picked) {
    const tag = item.type ?? 'goal';
    console.log(`  - [${tag}] ${item.text}`);
  }
}

// --- main ---

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'save':
      cmdSave(rest.join(' '));
      break;
    case 'context':
      cmdContext();
      break;
    case 'import':
      await cmdImport(rest);
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

// 顶层错误处理：parse / IO / 网络 等已知异常只打印中文消息；
// 非预期错误仍带堆栈，方便排查。
main().catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(`错误：${err.message}`);
  } else {
    console.error('错误：未知异常', err);
  }
  process.exit(1);
});
