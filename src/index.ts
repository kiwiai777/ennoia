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
import path from 'node:path';
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
import { createInjectionPackage } from './core/runtime/injection.js';
import type { Goal } from './core/user-model/types.js';
import {
  writeItemsToUserModel,
  targetFromCategory,
  type WriteableItem,
} from './core/user-model/write-items.js';

import { getAdapterForSource } from './adapters/registry.js';
import { createDescriptorFromPath } from './core/source/types.js';
import { basicExtract } from './core/extraction/basic-extractor.js';
import { llmExtract } from './core/extraction/llm-extractor.js';
import type {
  CandidateItem,
  CandidateType,
} from './core/extraction/types.js';

import { basicSuggest } from './core/suggestion/basic-suggester.js';
import { llmSuggest } from './core/suggestion/llm-suggester.js';
import type { SuggestionItem } from './core/suggestion/types.js';

function usage(): void {
  console.log('Cortex CLI');
  console.log('');
  console.log('用法：');
  console.log('  cortex save "<一段文本>"       把文本写入 user model（goals）');
  console.log('  cortex context                 输出当前 user context');
  console.log('  cortex inject [--agent <id>]   生成面向 agent 的正式注入文本（默认 generic）');
  console.log('  cortex import <path> [--llm]   从文件/目录导入并交互写入');
  console.log('  cortex suggest "<text>" [--llm] 从单段文本生成建议并交互写入');
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

function cmdInject(args: string[]): void {
  const model = loadUserModel();
  
  let agentId = 'generic';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--agent 缺少参数值。示例：--agent claude-code');
        process.exit(1);
      }
      agentId = args[i + 1];
      i++;
    } else {
      console.error(`错误：未知的参数 ${args[i]}`);
      process.exit(1);
    }
  }

  const pkg = createInjectionPackage(model, agentId);
  console.log(pkg.instruction_text);
}


// --- import ---

function printCandidates(items: CandidateItem[]): void {
  console.log('');
  console.log('检测到以下候选：');
  console.log('');
  items.forEach((item, i) => {
    const tag = item.type ? `[${item.type}]` : '[未分类]';
    const basename = path.basename(item.source_path);
    console.log(`${i + 1}. ${tag} ${item.text} (${basename})`);
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

// 写入结果摘要
interface WriteResult {
  written: CandidateItem[];
  skipped: CandidateItem[];
}

// 把候选按 type 分派进 user model 的对应数组。
// - 缺 type → 默认 goals
// - 每条 source 单独根据 source_path 生成（file-level provenance）
// - 对既有 model + 本次 batch 做精确归一化去重，重复跳过
//
// CT-0005：改用共享写入层 writeItemsToUserModel
function writeCandidates(
  items: CandidateItem[],
  mode: 'basic' | 'llm'
): WriteResult {
  const written: CandidateItem[] = [];
  const skipped: CandidateItem[] = [];
  if (items.length === 0) return { written, skipped };

  // 转换为 WriteableItem[]
  const writeables: WriteableItem[] = items.map((item) => {
    const type = item.type ?? 'goal';
    return {
      target: targetFromCategory(type),
      label: item.text,
      source: `cli:import:${mode}:${path.basename(item.source_path)}`,
    };
  });

  const result = writeItemsToUserModel(writeables);

  // 根据共享层返回的索引，重建 written / skipped 列表
  for (const w of result.writtenItems) {
    const idx = writeables.indexOf(w);
    if (idx !== -1) written.push(items[idx]);
  }
  for (const s of result.skippedItems) {
    const idx = writeables.indexOf(s);
    if (idx !== -1) skipped.push(items[idx]);
  }

  return { written, skipped };
}

async function cmdImport(args: string[]): Promise<void> {
  const useLlmFlag = args.includes('--llm');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    console.error('错误：import 需要一个路径。示例：cortex import ./notes.md');
    process.exit(1);
  }

  // CT-0006：构造 SourceDescriptor，通过 registry 选择 adapter
  let descriptor;
  try {
    descriptor = createDescriptorFromPath(target);
    // CT-0007: 支持显式指定 adapter
    const adapterIndex = args.indexOf('--adapter');
    if (adapterIndex !== -1 && adapterIndex + 1 < args.length) {
      descriptor.adapter = args[adapterIndex + 1];
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`错误：${err.message}`);
    } else {
      console.error('错误：无法识别该路径');
    }
    process.exit(1);
  }

  let adapter;
  try {
    adapter = getAdapterForSource(descriptor);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`错误：${err.message}`);
    } else {
      console.error('错误：无 adapter 能处理该来源');
    }
    process.exit(1);
  }

  const blocks = await adapter.load(descriptor);
  console.log(`已读取 ${blocks.length} 个文本块（来自 ${target}）`);

  // LLM 模式仅在 flag + key 同时存在时启用，否则退回 basic
  const llmAvailable = useLlmFlag && Boolean(process.env.OPENAI_API_KEY);
  let candidates: CandidateItem[];
  let mode: 'basic' | 'llm';

  if (useLlmFlag && !process.env.OPENAI_API_KEY) {
    console.log('未启用 LLM，使用基础模式（缺少 OPENAI_API_KEY）');
  }

  if (llmAvailable) {
    console.log('使用 LLM 提取候选…');
    candidates = await llmExtract(blocks);
    mode = 'llm';
  } else {
    if (!useLlmFlag) {
      console.log('未启用 LLM，使用基础模式');
    }
    candidates = basicExtract(blocks);
    mode = 'basic';
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
  const { written, skipped } = writeCandidates(picked, mode);

  console.log('');
  if (written.length > 0) {
    console.log(`已写入 ${written.length} 条到 user model：`);
    for (const item of written) {
      const tag = item.type ?? 'goal';
      const basename = path.basename(item.source_path);
      console.log(`  - [${tag}] ${item.text} (${basename})`);
    }
  } else {
    console.log('未写入任何条目。');
  }
  if (skipped.length > 0) {
    console.log(`已跳过 ${skipped.length} 条重复项`);
  }
}

// --- suggest ---

function printSuggestions(items: SuggestionItem[]): void {
  console.log('');
  console.log('检测到以下建议：');
  console.log('');
  items.forEach((item, i) => {
    console.log(`${i + 1}. [${item.type}] ${item.text}`);
  });
  console.log('');
}

interface SuggestWriteResult {
  written: SuggestionItem[];
  skipped: SuggestionItem[];
}

// 把选中的 suggestion 分派进 user model 的对应数组。
// - 每条 source 直接使用 SuggestionItem.source（cli:suggest:basic / llm）
// - 对既有 model + 本次 batch 做精确归一化去重（与 CT-0003 写入语义一致）
//
// CT-0005：改用共享写入层 writeItemsToUserModel
function writeSuggestions(items: SuggestionItem[]): SuggestWriteResult {
  const written: SuggestionItem[] = [];
  const skipped: SuggestionItem[] = [];
  if (items.length === 0) return { written, skipped };

  // 转换为 WriteableItem[]
  const writeables: WriteableItem[] = items.map((item) => ({
    target: targetFromCategory(item.type),
    label: item.text,
    source: item.source,
  }));

  const result = writeItemsToUserModel(writeables);

  // 根据共享层返回的索引，重建 written / skipped 列表
  for (const w of result.writtenItems) {
    const idx = writeables.indexOf(w);
    if (idx !== -1) written.push(items[idx]);
  }
  for (const s of result.skippedItems) {
    const idx = writeables.indexOf(s);
    if (idx !== -1) skipped.push(items[idx]);
  }

  return { written, skipped };
}

async function cmdSuggest(args: string[]): Promise<void> {
  const useLlmFlag = args.includes('--llm');
  const text = args
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim();

  if (!text) {
    console.error(
      '错误：suggest 需要一段文本。示例：cortex suggest "我想推进 Cortex，但要避免单点依赖"'
    );
    process.exit(1);
  }

  const llmAvailable = useLlmFlag && Boolean(process.env.OPENAI_API_KEY);

  if (useLlmFlag && !process.env.OPENAI_API_KEY) {
    console.log('未启用 LLM，使用基础模式（缺少 OPENAI_API_KEY）');
  }

  let suggestions: SuggestionItem[];
  if (llmAvailable) {
    console.log('使用 LLM 提取建议…');
    suggestions = await llmSuggest(text);
  } else {
    if (!useLlmFlag) {
      console.log('未启用 LLM，使用基础模式');
    }
    suggestions = basicSuggest(text);
  }

  if (suggestions.length === 0) {
    console.log('未提取到任何建议，已退出。');
    return;
  }

  printSuggestions(suggestions);
  const indices = await promptSelection(suggestions.length);

  if (indices.length === 0) {
    console.log('未选择任何建议，已退出。');
    return;
  }

  const picked = indices.map((i) => suggestions[i]);
  const { written, skipped } = writeSuggestions(picked);

  console.log('');
  if (written.length > 0) {
    console.log(`已写入 ${written.length} 条到 user model：`);
    for (const item of written) {
      console.log(`  - [${item.type}] ${item.text}`);
    }
  } else {
    console.log('未写入任何条目。');
  }
  if (skipped.length > 0) {
    console.log(`已跳过 ${skipped.length} 条重复项`);
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
    case 'inject':
      cmdInject(rest);
      break;
    case 'import':
      await cmdImport(rest);
      break;
    case 'suggest':
      await cmdSuggest(rest);
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
