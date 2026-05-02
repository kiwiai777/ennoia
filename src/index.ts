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
import { fileURLToPath } from 'node:url';

import {
  loadUserModel,
  updateUserModel,
  saveUserModel,
  getUserModelPath,
} from './core/user-model/storage.js';
import {
  selectRuntimeContext,
  renderContextForHuman,
} from './core/runtime/context.js';
import { createInjectionPackage } from './core/runtime/injection.js';
import {
  buildInjectionPack,
  serializeInjectionPack,
} from './core/runtime/injection-pack.js';
import { projectPackForClaudeCode } from './adapters/claude-code/projector.js';
import type { Goal } from './core/user-model/types.js';
import {
  writeItemsToUserModel,
  targetFromCategory,
  type WriteableItem,
  type WriteCategory,
} from './core/user-model/write-items.js';

import { getAdapterForSource } from './adapters/registry.js';
import { createDescriptorFromPath } from './core/source/types.js';
import { basicExtract } from './core/extraction/basic-extractor.js';
import { llmExtract } from './core/extraction/llm-extractor.js';
import type {
  CandidateItem,
  CandidateType,
  ExtractionCandidate,
} from './core/extraction/types.js';
import { extractFromClaudeCodeWorkspace } from './adapters/claude-code/index.js';
import { extractFromOpenClawWorkspace, injectToOpenClaw } from './adapters/openclaw/index.js';
import { resolveWorkspacePath } from './adapters/openclaw/workspace.js';
import { extractFromChatGPTExport } from './adapters/chatgpt-export/index.js';
import { extractContentBlocksFromChatGPT } from './adapters/chatgpt-export/content-blocks.js';
import { ALL_INJECT_TARGETS, injectToTarget, type InjectTarget } from './adapters/inject-targets.js';

// CT-0027-04: Pipeline + backends
import { loadConfig } from './backends/config.js';
import { createLLMBackend, createEmbeddingBackend } from './backends/factory.js';
import { runExtractionPipeline } from './core/extraction/pipeline.js';
import { migrateUserModelV0_2, needsMigration } from './core/user-model/migrate.js';
import type { ContentBlock } from './core/extraction/types.js';

import { basicSuggest } from './core/suggestion/basic-suggester.js';
import { llmSuggest } from './core/suggestion/llm-suggester.js';
import type { SuggestionItem } from './core/suggestion/types.js';
import {
  appendObservation,
  loadObservationLog,
  renderObservation,
  buildRecap,
  renderRecap,
  buildHealthSignals,
  renderHealthSignals,
  buildTriggerHints,
  renderTriggerHints,
} from './core/runtime/observation.js';

import { generateCandidatesFromRecent } from './core/suggest-loop/generateCandidatesFromRecent.js';
import { buildSuggestions } from './core/suggest-loop/buildSuggestions.js';

function usage(): void {
  console.log('Cortex CLI');
  console.log('');
  console.log('用法：');
  console.log('  cortex save "<一段文本>"       把文本写入 user model（goals）');
  console.log('  cortex context [--scope <scope>] [--task-hint "<hint>"]');
  console.log('                                 输出当前 user context');
  console.log('                                 --scope 聚焦到特定项目（名/id）');
  console.log('                                 --task-hint 按任务线索过滤');
  console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]');
  console.log('  cortex inject --all-targets [--workspace <path>] [--dry-run]');
  console.log('  cortex inject [--agent <id>] [--format text|json]');
  console.log('                [--scope <scope>] [--task-hint "<hint>"]');
  console.log('                [--with-observation]');
  console.log('                                 生成面向 agent 的注入内容');
  console.log('                                 默认 --agent generic --format text');
  console.log('                                 --scope 指定关注范围（项目名/id）');
  console.log('                                 --task-hint 提供当前任务线索（文本匹配）');
  console.log('                                 --with-observation 附带运行时使用摘要');
  console.log('  cortex import <path> [--llm]   从文件/目录导入并交互写入');
  console.log('  cortex suggest "<text>" [--llm] 从单段文本生成建议并交互写入');
  console.log('  cortex observe                 查看最近 context / inject 使用记录');
  console.log('  cortex reflect "<文本>"        从近期 activity 提取建议并交互写入');
  console.log('  cortex reflect --stdin [--accept-all]');
  console.log('                                 从 stdin 按行读取多条输入；');
  console.log('                                 --accept-all 跳过交互，全部候选自动确认');
  console.log('                                 （管道 / 非 TTY 场景必须加 --accept-all）');
  console.log('  cortex reflect --list          查看最近 20 条已确认的 suggest-loop 记录');
  console.log('  cortex sync --from claude-code|openclaw|chatgpt-export [--accept-all] [--dry-run]');
  console.log('                                 从 Claude Code workspace 扫描候选并写入 user model');
  console.log('');
  console.log(`存储位置：${getUserModelPath()}`);
}

// CT-0014/CT-0020：最小 observation 查看入口。
// 收敛重构：只保留 trigger hints, health signals, recap, records 四层。
// 移除 candidates 层以消除重复语义。
export function cmdObserve(args: string[] = []): void {
  if (args.length > 0) {
    console.error(`错误：observe 不支持参数 ${args[0]}`);
    process.exit(1);
  }
  const log = loadObservationLog();
  const all = log.observations;
  if (all.length === 0) {
    console.log('（暂无使用记录）');
    return;
  }

  // CT-0017/CT-0020: trigger hints (最顶层，已收敛重复的 candidate 逻辑)
  const hintsText = renderTriggerHints(buildTriggerHints(all));
  if (hintsText) {
    console.log(hintsText);
    console.log('');
  }

  // CT-0016: health signals
  const signalsText = renderHealthSignals(buildHealthSignals(all));
  if (signalsText) {
    console.log(signalsText);
    console.log('');
  }

  // CT-0015: 摘要层（recap）
  const recap = buildRecap(all);
  console.log(renderRecap(recap));
  console.log('');

  const SHOW = 20;
  const recent = all.slice(-SHOW).reverse();
  console.log('[最近使用记录]');
  console.log('');
  for (const obs of recent) {
    console.log('  ' + renderObservation(obs));
  }
  if (all.length > SHOW) {
    console.log('');
    console.log(`  （共 ${all.length} 条，显示最近 ${SHOW} 条）`);
  }
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

// CT-0013：支持 --scope / --task-hint，与 inject 共享同一 selection 结果。
export function cmdContext(args: string[] = []): void {
  const model = loadUserModel();

  let scope: string | undefined;
  let taskHint: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--scope') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--scope 缺少参数值。示例：--scope Cortex');
        process.exit(1);
      }
      scope = args[++i];
    } else if (arg === '--task-hint') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--task-hint 缺少参数值。示例：--task-hint "planning injection"');
        process.exit(1);
      }
      taskHint = args[++i];
    } else {
      console.error(`错误：context 不支持参数 ${arg}`);
      process.exit(1);
    }
  }

  const ctx = selectRuntimeContext(model, { scope, taskHint });
  console.log(renderContextForHuman(ctx));

  // CT-0014：记录使用事件（fail-soft：写入失败不影响主功能）
  appendObservation({
    event_type: 'context',
    scope,
    task_hint: taskHint,
    selection_strategy: ctx.meta.selection_strategy,
    selected_entries: ctx.meta.selected_entries,
    total_entries: ctx.meta.total_model_entries,
  });
}

export async function injectAllTargets(opts: {
  workspacePath?: string;
  dryRun?: boolean;
}): Promise<void> {
  const results: { target: InjectTarget; ok: boolean; error?: string }[] = [];

  for (const target of ALL_INJECT_TARGETS) {
    try {
      console.log(`\n--- ${target} ---`);
      await injectToTarget(target, opts);
      results.push({ target, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${target}: ${msg}`);
      results.push({ target, ok: false, error: msg });
      // continue-on-error: 不中断，继续下一个 target
    }
  }

  // 汇总
  console.log('\n=== 汇总 ===');
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  console.log(`✓ ${okCount} 个 target 成功`);
  if (failCount > 0) {
    console.log(`✗ ${failCount} 个 target 失败`);
    for (const r of results.filter(r => !r.ok)) {
      console.log(`   - ${r.target}: ${r.error}`);
    }
    process.exit(1);   // 整体退出码非 0，提示有失败
  }
}

type InjectFormat = 'text' | 'json';

// CT-0011：支持 --scope 和 --task-hint，三条输出路径共享同一 selection 结果。
export async function cmdInject(args: string[]): Promise<void> {
  const model = loadUserModel();

  let agentId = 'generic';
  let format: InjectFormat = 'text';
  let scope: string | undefined;
  let taskHint: string | undefined;
  let withObservation = false;
  let target: string | undefined;
  let allTargets = false;
  let workspace: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--target 缺少参数值。示例：--target openclaw');
        process.exit(1);
      }
      target = args[i + 1];
      i++;
    } else if (arg === '--all-targets') {
      allTargets = true;
    } else if (arg === '--workspace') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--workspace 缺少参数值。');
        process.exit(1);
      }
      workspace = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--agent') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--agent 缺少参数值。示例：--agent claude-code');
        process.exit(1);
      }
      agentId = args[i + 1];
      i++;
    } else if (arg === '--format') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--format 缺少参数值。可选值：text | json');
        process.exit(1);
      }
      const value = args[i + 1];
      if (value !== 'text' && value !== 'json') {
        console.error(`错误：--format 取值非法（${value}）。可选值：text | json`);
        process.exit(1);
      }
      format = value;
      i++;
    } else if (arg === '--scope') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--scope 缺少参数值。示例：--scope Cortex');
        process.exit(1);
      }
      scope = args[i + 1];
      i++;
    } else if (arg === '--task-hint') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--task-hint 缺少参数值。示例：--task-hint "planning injection"');
        process.exit(1);
      }
      taskHint = args[i + 1];
      i++;
    } else if (arg === '--with-observation') {
      withObservation = true;
    } else {
      console.error(`错误：未知的参数 ${arg}`);
      process.exit(1);
    }
  }

  if (allTargets) {
    if (target) {
      console.error('错误：--all-targets 与 --target 不能同时使用');
      process.exit(1);
    }
    await injectAllTargets({ workspacePath: workspace, dryRun });
    return;
  }

  if (target === 'openclaw') {
    await injectToOpenClaw({ workspacePath: workspace, dryRun });
    return;
  }

  // CT-0019: 如果开启，则读取 observation 日志用于构建 recap (对 json format 无效，保留此逻辑避免副作用)
  let recap;
  if (withObservation && format === 'text') {
    const log = loadObservationLog();
    recap = buildRecap(log.observations);
  }

  // CT-0014：在成功路径执行前先做一次 selection 以获取 meta（纯内存，无 IO）
  const injectCtx = selectRuntimeContext(model, { agent: agentId, scope, taskHint });

  if (format === 'json') {
    const pack = buildInjectionPack(model, { agent: agentId, scope, taskHint });
    console.log(serializeInjectionPack(pack));
    appendObservation({
      event_type: 'inject',
      agent: agentId,
      scope,
      task_hint: taskHint,
      selection_strategy: injectCtx.meta.selection_strategy,
      selected_entries: injectCtx.meta.selected_entries,
      total_entries: injectCtx.meta.total_model_entries,
    });
    return;
  }

  // text 路径：claude-code 走 structured pack → projector；其他 agent 保持 CT-0008 行为。
  if (agentId === 'claude-code') {
    const pack = buildInjectionPack(model, { agent: agentId, scope, taskHint });
    const projection = projectPackForClaudeCode(pack, { recap });
    console.log(projection.instruction_text);
    appendObservation({
      event_type: 'inject',
      agent: agentId,
      scope,
      task_hint: taskHint,
      selection_strategy: injectCtx.meta.selection_strategy,
      selected_entries: injectCtx.meta.selected_entries,
      total_entries: injectCtx.meta.total_model_entries,
    });
    return;
  }

  const pkg = createInjectionPackage(model, agentId, { scope, taskHint, recap });
  console.log(pkg.instruction_text);
  appendObservation({
    event_type: 'inject',
    agent: agentId,
    scope,
    task_hint: taskHint,
    selection_strategy: injectCtx.meta.selection_strategy,
    selected_entries: injectCtx.meta.selected_entries,
    total_entries: injectCtx.meta.total_model_entries,
  });
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
    const rawType = item.type ?? 'goal';
    const validCategories = new Set<string>(['goal', 'constraint', 'preference']);
    const type: WriteCategory = validCategories.has(rawType) ? rawType as WriteCategory : 'goal';
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
  let useLlmFlag = false;
  let adapterId: string | undefined = undefined;
  const targets: string[] = [];

  // 1. 扫描 args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--llm') {
      useLlmFlag = true;
    } else if (arg === '--adapter') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--adapter 缺少参数值。示例：--adapter claude-code');
        process.exit(1);
      }
      adapterId = args[i + 1];
      i++; // 跳过下一个参数
    } else if (arg.startsWith('--')) {
      console.error(`错误：未知的参数 ${arg}`);
      process.exit(1);
    } else {
      targets.push(arg);
    }
  }

  if (targets.length === 0) {
    console.error('错误：import 需要一个路径。示例：cortex import ./notes.md');
    process.exit(1);
  }
  
  if (targets.length > 1) {
    console.error(`错误：import 只允许一个路径，但收到了多个：${targets.join(', ')}`);
    process.exit(1);
  }

  const target = targets[0];

  // CT-0006/CT-0007：构造 SourceDescriptor，通过 registry 选择 adapter
  let descriptor;
  try {
    descriptor = createDescriptorFromPath(target);
    if (adapterId) {
      descriptor.adapter = adapterId;
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
    console.log(`\nℹ️  运行 cortex inject --all-targets 同步到所有 agent`);
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
    console.log(`\nℹ️  运行 cortex inject --all-targets 同步到所有 agent`);
  } else {
    console.log('未写入任何条目。');
  }
  if (skipped.length > 0) {
    console.log(`已跳过 ${skipped.length} 条重复项`);
  }
}

// --- sync ---

function printExtractionCandidates(items: ExtractionCandidate[]): void {
  items.forEach((item, i) => {
    console.log(`\n[${i + 1}] ${item.kind}: ${item.content}`);
    console.log(`    (from: ${item.provenance.path})`);
  });
}

export interface SyncOptions {
  // Injection points for testing
  promptFn?: (total: number) => Promise<number[]>;
  extractFn?: (rootPath: string) => Promise<ExtractionCandidate[]>;
}

export async function cmdSync(args: string[], opts: SyncOptions = {}): Promise<void> {
  const _promptFn = opts.promptFn ?? promptSelection;
  const _extractFn = opts.extractFn ?? extractFromClaudeCodeWorkspace;

  // 参数解析
  const fromIdx = args.indexOf('--from');
  const acceptAll = args.includes('--accept-all');
  const dryRun = args.includes('--dry-run');

  // --accept-all 与 --dry-run 互斥
  if (acceptAll && dryRun) {
    console.error('错误：--accept-all 与 --dry-run 互斥');
    process.exit(1);
  }

  // --from 必需
  if (fromIdx === -1 || !args[fromIdx + 1]) {
    console.error('用法：cortex sync --from <adapter-id> [--accept-all] [--dry-run]');
    console.error('当前支持的 adapter：claude-code, openclaw, chatgpt-export');
    process.exit(1);
  }

  const adapterId = args[fromIdx + 1];
  if (adapterId !== 'claude-code' && adapterId !== 'openclaw' && adapterId !== 'chatgpt-export') {
    console.error(`adapter 不支持：${adapterId}`);
    console.error('当前支持的 adapter：claude-code, openclaw, chatgpt-export');
    process.exit(1);
  }

  // 检查未知参数
  const knownArgs = new Set(['--from', adapterId, '--accept-all', '--dry-run', '--workspace', '--since', '--min-length', '--max-conversations']);
  const unknown = args.filter(a => a.startsWith('-') && !knownArgs.has(a));
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(', ')}`);
    process.exit(1);
  }

  const workspaceRoot = process.cwd();

  let targetWorkspace = workspaceRoot;
  const posArg = args.find(a => !a.startsWith('-') && a !== 'sync' && a !== 'cortex' && a !== adapterId && args[args.indexOf(a) - 1] !== '--from');
  if (posArg) {
    targetWorkspace = posArg;
  } else if (adapterId === 'openclaw') {
    targetWorkspace = undefined as any;
  }

  let displayWorkspace = targetWorkspace;
  if (adapterId === 'openclaw') {
    try {
      displayWorkspace = resolveWorkspacePath(targetWorkspace);
    } catch (e) {
      displayWorkspace = 'OpenClaw Workspace';
    }
  }

  // 扫描
  console.log('Cortex 正在从你的 workspace 理解你（不是记录你）...');
  console.log(`扫描路径：${displayWorkspace}`);


  // Parse chatgpt-export specific arguments
  let chatgptWorkspace: string | undefined;
  let chatgptSince: Date | undefined;
  let chatgptMinLength: number | undefined;
  let chatgptMaxConversations: number | undefined;

  if (adapterId === 'chatgpt-export') {
    const workspaceIdx = args.indexOf('--workspace');
    if (workspaceIdx !== -1 && args[workspaceIdx + 1]) {
      chatgptWorkspace = args[workspaceIdx + 1];
    }

    const sinceIdx = args.indexOf('--since');
    if (sinceIdx !== -1 && args[sinceIdx + 1]) {
      chatgptSince = new Date(args[sinceIdx + 1]);
    }

    const minLengthIdx = args.indexOf('--min-length');
    if (minLengthIdx !== -1 && args[minLengthIdx + 1]) {
      chatgptMinLength = parseInt(args[minLengthIdx + 1], 10);
    }

    const maxConvIdx = args.indexOf('--max-conversations');
    if (maxConvIdx !== -1 && args[maxConvIdx + 1]) {
      chatgptMaxConversations = parseInt(args[maxConvIdx + 1], 10);
    }

    if (!chatgptWorkspace) {
      console.error('错误���chatgpt-export adapter 需要 --workspace 参���');
      console.error('用��：cortex sync --from chatgpt-export --workspace <path> [--since YYYY-MM] [--min-length N] [--max-conversations N]');
      process.exit(1);
    }
  }

  // Update displayWorkspace for chatgpt-export
  if (adapterId === 'chatgpt-export') {
    displayWorkspace = chatgptWorkspace || 'ChatGPT Export';
  }

  // CT-0027-04: 加载 config 和��建 backends
  const config = loadConfig();
  const llmBackend = config.llm.enabled ? createLLMBackend(config.llm) : undefined;
  const embeddingBackend = config.embedding.enabled ? createEmbeddingBackend(config.embedding) : undefined;

  // CT-0027-04: 启动���自动迁移 user_model（如���要）
  if (embeddingBackend) {
    const currentModel = loadUserModel();
    if (needsMigration(currentModel)) {
      const migratedModel = await migrateUserModelV0_2(currentModel, embeddingBackend);
      saveUserModel(migratedModel);
    }
  }

  // CT-0027-04: 获取 ContentBlock[] ��不是��接获�� ExtractionCandidate[]
  let contentBlocks: ContentBlock[];
  if (adapterId === 'chatgpt-export') {
    contentBlocks = await extractContentBlocksFromChatGPT({
      exportPath: chatgptWorkspace!,
      since: chatgptSince,
      minChars: chatgptMinLength,
      maxConversations: chatgptMaxConversations,
    });
  } else {
    // 其他 adapter 暂时使用��逻辑���返回 ExtractionCandidate[]）
    // 未来��以逐步��移到 ContentBlock[]
    const oldCandidates = adapterId === 'openclaw'
      ? await extractFromOpenClawWorkspace(targetWorkspace)
      : await _extractFn(targetWorkspace);

    if (oldCandidates.length === 0) {
      console.log('未从 workspace 中提取��候选事��。');
      console.log('请确认 workspace ��存在 CLAUDE.md / README.md / package.json / .claude/ ��录。');
      return;
    }

    console.log(`\n扫��到 ${oldCandidates.length} 个候选��实。`);

    // 旧逻��：直接��用 ExtractionCandidate[]
    const SUPPORTED_KINDS = new Set<string>(['goal', 'constraint', 'preference']);
    const supportedCandidates = oldCandidates.filter(c => SUPPORTED_KINDS.has(c.kind));
    const unsupportedCandidates = oldCandidates.filter(c => !SUPPORTED_KINDS.has(c.kind));

    if (unsupportedCandidates.length > 0) {
      const unsupportedKinds = [...new Set(unsupportedCandidates.map(c => c.kind))];
      const kindList = unsupportedKinds.map(k => `'${k}'`).join(' / ');
      console.warn(`⚠ ${unsupportedCandidates.length} 条��选因 kind ${kindList} ��不受写入��支持���跳过：`);
      for (const c of unsupportedCandidates) {
        const snippet = c.content.length > 60 ? c.content.slice(0, 60) + '...' : c.content;
        console.warn(`  - ${c.kind}: ${snippet}  (from: ${c.provenance.path})`);
      }
      console.warn(`（未��卡片��扩展写入��支持���有 kind）`);
    }

    if (supportedCandidates.length === 0) {
      console.log('过滤���无可写入��候选。');
      return;
    }

    // 展���候选
    printExtractionCandidates(supportedCandidates);
    console.log('');

    // dry-run：只展示��写入
    if (dryRun) {
      console.log('[dry-run] 以上候选��写入。使�� --accept-all 或交��模式��入。');
      return;
    }

    // 确��要写���的候��
    let selectedIndices: number[];

    if (acceptAll) {
      selectedIndices = supportedCandidates.map((_, i) => i);
    } else {
      // ���互确认
      if (!process.stdin.isTTY) {
        console.error('错��：交���模式需�� TTY。使�� --accept-all 跳过交��，或��过 --stdin 管道��入。');
        process.exit(1);
      }
      console.log('选择���写入 user model 的���选（输入��号，���号分��，或 "a" 全选）��');
      selectedIndices = await _promptFn(supportedCandidates.length);
    }

    if (selectedIndices.length === 0) {
      console.log('未选择任��候选���退出。');
      return;
    }

    const selectedCandidates = selectedIndices.map(i => supportedCandidates[i]);

    // 构建 WriteableItem[]
    const writeables: WriteableItem[] = selectedCandidates.map(c => ({
      target: targetFromCategory(c.kind as WriteCategory),
      label: c.content,
      source: `cli:sync:${adapterId}:${c.provenance.path}`,
    }));

    const result = writeItemsToUserModel(writeables, {
      embeddingBackend,
      threshold: config.embedding.similarityThreshold,
    });

    // 成功输出
    const writtenCount = result.writtenItems.length;
    const skippedCount = result.skippedItems.length;
    const supersededCount = result.superseded;

    console.log(`\n�� 写入 ${writtenCount} 条事���到你�� user model`);

    if (writtenCount > 0) {
      const byKind: Record<string, number> = {};
      for (let i = 0; i < selectedCandidates.length; i++) {
        if (result.writtenItems.includes(writeables[i])) {
          const k = selectedCandidates[i].kind;
          byKind[k] = (byKind[k] ?? 0) + 1;
        }
      }
      const summary = Object.entries(byKind).map(([k, v]) => `${k}s: ${v}`).join(', ');
      if (summary) console.log(`  ( ${summary} )`);
    }

    if (supersededCount > 0) {
      console.log(`  (${supersededCount} 条替换旧��好（���标记 superseded���)`);
    }

    if (skippedCount > 0) {
      console.log(`  (${skippedCount} 条��重复��跳过)`);
    }

    console.log(`\nYour user model is now ${writtenCount} facts richer.`);
    console.log('运�� `cortex context` 查看��整 user model。');
    console.log('���行 `cortex inject --format text` 获取可贴��其他 AI 的 context。');

    if (!dryRun && writtenCount > 0) {
      console.log(`\nℹ���  运行 cortex inject --all-targets 同步到��有 agent`);
    }
    return;
  }

  // CT-0027-04: ��逻辑 - 使用 pipeline
  if (contentBlocks.length === 0) {
    console.log('���从 workspace 中提���到内容块。');
    return;
  }

  // 运�� pipeline
  const allCandidates = await runExtractionPipeline(contentBlocks, {
    llmBackend,
    embeddingBackend,
    config,
  });

  if (allCandidates.length === 0) {
    console.log('未从 workspace 中提取到候选事实。');
    console.log('请确认 workspace 中存在 CLAUDE.md / README.md / package.json / .claude/ 目录。');
    return;
  }

  console.log(`\n扫描到 ${allCandidates.length} 个候选事实。`);

  // kind 过滤：写入层只支持 goal | constraint | preference
  const SUPPORTED_KINDS = new Set<string>(['goal', 'constraint', 'preference']);
  const supportedCandidates = allCandidates.filter(c => SUPPORTED_KINDS.has(c.kind));
  const unsupportedCandidates = allCandidates.filter(c => !SUPPORTED_KINDS.has(c.kind));

  if (unsupportedCandidates.length > 0) {
    const unsupportedKinds = [...new Set(unsupportedCandidates.map(c => c.kind))];
    const kindList = unsupportedKinds.map(k => `'${k}'`).join(' / ');
    console.warn(`⚠ ${unsupportedCandidates.length} 条候选因 kind ${kindList} 暂不受写入层支持已跳过：`);
    for (const c of unsupportedCandidates) {
      const snippet = c.content.length > 60 ? c.content.slice(0, 60) + '...' : c.content;
      console.warn(`  - ${c.kind}: ${snippet}  (from: ${c.provenance.path})`);
    }
    console.warn(`（未来卡片将扩展写入层支持所有 kind）`);
  }

  if (supportedCandidates.length === 0) {
    console.log('过滤后无可写入的候选。');
    return;
  }

  // 展示候选
  printExtractionCandidates(supportedCandidates);
  console.log('');

  // dry-run：只展示不写入
  if (dryRun) {
    console.log('[dry-run] 以上候选未写入。使用 --accept-all 或交互模式写入。');
    return;
  }

  // 确定要写入的候选
  let selectedIndices: number[];

  if (acceptAll) {
    selectedIndices = supportedCandidates.map((_, i) => i);
  } else {
    // 交互确认
    if (!process.stdin.isTTY) {
      console.error('错误：交互模式需要 TTY。使用 --accept-all 跳过交互，或通过 --stdin 管道输入。');
      process.exit(1);
    }
    console.log('选择要写入 user model 的候选（输入编号，逗号分隔，或 "a" 全选）：');
    selectedIndices = await _promptFn(supportedCandidates.length);
  }

  if (selectedIndices.length === 0) {
    console.log('未选择任何候选，退出。');
    return;
  }

  const selectedCandidates = selectedIndices.map(i => supportedCandidates[i]);

  // 构建 WriteableItem[]
  const writeables: WriteableItem[] = selectedCandidates.map(c => ({
    target: targetFromCategory(c.kind as WriteCategory),
    label: c.content,
    source: `cli:sync:${adapterId}:${c.provenance.path}`,
  }));

  const result = writeItemsToUserModel(writeables, {
    embeddingBackend,
    threshold: config.embedding.similarityThreshold,
  });

  // 成功输出
  const writtenCount = result.writtenItems.length;
  const skippedCount = result.skippedItems.length;

  console.log(`\n✓ 写入 ${writtenCount} 条事实到你的 user model`);

  if (writtenCount > 0) {
    const byKind: Record<string, number> = {};
    for (let i = 0; i < selectedCandidates.length; i++) {
      if (result.writtenItems.includes(writeables[i])) {
        const k = selectedCandidates[i].kind;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    const summary = Object.entries(byKind).map(([k, v]) => `${k}s: ${v}`).join(', ');
    if (summary) console.log(`  ( ${summary} )`);
  }

  if (skippedCount > 0) {
    console.log(`  (${skippedCount} 条因重复已跳过)`);
  }

  console.log(`\nYour user model is now ${writtenCount} facts richer.`);
  console.log('运行 `cortex context` 查看完整 user model。');
  console.log('运行 `cortex inject --format text` 获取可贴给其他 AI 的 context。');

  if (!dryRun && writtenCount > 0) {
    console.log(`\nℹ️  运行 cortex inject --all-targets 同步到所有 agent`);
  }
}

// --- reflect ---

export interface ReflectOptions {
  // Injection points for testing
  promptFn?: (total: number) => Promise<number[]>;
  readStdinFn?: () => Promise<string[]>;
}

async function defaultReadStdinLines(): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => lines.push(line));
    rl.on('close', () => resolve(lines));
  });
}

export async function cmdReflect(args: string[], opts: ReflectOptions = {}): Promise<void> {
  const _promptFn = opts.promptFn ?? promptSelection;
  const _readStdinFn = opts.readStdinFn ?? defaultReadStdinLines;

  let useStdin = false;
  let acceptAll = false;
  let listMode = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--stdin') {
      useStdin = true;
    } else if (arg === '--accept-all') {
      acceptAll = true;
    } else if (arg === '--list') {
      listMode = true;
    } else if (arg.startsWith('--')) {
      console.error(`错误：reflect 不支持参数 ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  // --list mode is no longer supported with the deprecation of suggest-loop-store.json
  if (listMode) {
    console.error('错误：--list 已废弃。reflect 现在直接写入主 user model，请使用 cortex context 查看。');
    process.exit(1);
  }

  // --accept-all is only meaningful with --stdin; combining with positional args is ambiguous.
  if (acceptAll && positional.length > 0) {
    console.error('错误：--accept-all 不可与位置参数组合使用，请改用 --stdin --accept-all');
    process.exit(1);
  }

  // Mutual exclusion: --stdin and positional args.
  if (useStdin && positional.length > 0) {
    console.error('错误：--stdin 与位置参数互斥');
    process.exit(1);
  }

  // Preflight: non-TTY stdin without --accept-all would silently fail at interactive selection.
  if (useStdin && !acceptAll && process.stdin.isTTY !== true) {
    console.error(
      '错误：检测到非交互输入（stdin 非 TTY），无法进入交互选择。\n' +
      '请添加 --accept-all 自动确认全部候选，或改用位置参数：cortex reflect "文本"',
    );
    process.exit(1);
  }

  let inputs: string[];
  if (useStdin) {
    const lines = await _readStdinFn();
    inputs = lines.map((l) => l.trim()).filter((l) => l !== '');
    if (inputs.length === 0) {
      console.error('错误：stdin 为空，无候选输入');
      process.exit(1);
    }
  } else {
    const text = positional.join(' ').trim();
    if (!text) {
      console.error('错误：reflect 需要一段文本。示例：cortex reflect "..."');
      process.exit(1);
    }
    inputs = [text];
  }

  const candidates = generateCandidatesFromRecent(inputs);
  const suggestions = buildSuggestions(candidates);

  if (suggestions.length === 0) {
    console.log('未发现任何候选，已退出。');
    return;
  }

  console.log('');
  console.log('检测到以下候选：');
  console.log('');
  suggestions.forEach((item, i) => {
    console.log(`${i + 1}. ${item.displayText}`);
  });
  console.log('');

  const confirmedIndices = acceptAll
    ? suggestions.map((_, i) => i)
    : await _promptFn(suggestions.length);

  if (confirmedIndices.length === 0) {
    console.log('未选择任何候选，已退出。');
    return;
  }

  const selectedCandidates = confirmedIndices.map(i => suggestions[i]);

  const writeables: WriteableItem[] = selectedCandidates.map(c => ({
    target: targetFromCategory(c.type as WriteCategory),
    label: c.content,
    source: 'cli:reflect:suggest',
  }));

  const result = writeItemsToUserModel(writeables);

  const writtenCount = result.writtenItems.length;
  const skippedCount = result.skippedItems.length;

  console.log(`\n✓ 写入 ${writtenCount} 条事实到你的 user model`);

  if (writtenCount > 0) {
    const byKind: Record<string, number> = {};
    for (let i = 0; i < selectedCandidates.length; i++) {
      if (result.writtenItems.includes(writeables[i])) {
        const k = selectedCandidates[i].type;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    const summary = Object.entries(byKind).map(([k, v]) => `${k}s: ${v}`).join(', ');
    if (summary) console.log(`  ( ${summary} )`);
  }

  if (skippedCount > 0) {
    console.log(`  (${skippedCount} 条因重复已跳过)`);
  }

  console.log(`\nYour user model is now ${writtenCount} facts richer.`);
  console.log('运行 `cortex context` 查看完整 user model。');
  console.log('运行 `cortex inject --format text` 获取可贴给其他 AI 的 context。');

  if (writtenCount > 0) {
    console.log(`\nℹ️  运行 cortex inject --all-targets 同步到所有 agent`);
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
      cmdContext(rest);
      break;
    case 'inject':
      await cmdInject(rest);
      break;
    case 'observe':
      cmdObserve(rest);
      break;
    case 'import':
      await cmdImport(rest);
      break;
    case 'suggest':
      await cmdSuggest(rest);
      break;
    case 'reflect':
      await cmdReflect(rest);
      break;
    case 'sync':
      await cmdSync(rest);
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

// 只在直接作为入口运行时启动 main()；作为模块被 import 时跳过，
// 避免测试加载时意外执行 CLI 逻辑。
if (process.argv[1] != null &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err: unknown) => {
    if (err instanceof Error) {
      console.error(`错误：${err.message}`);
    } else {
      console.error('错误：未知异常', err);
    }
    process.exit(1);
  });
}
