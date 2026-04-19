// Runtime Observation Foundation（CT-0014）
//
// 记录"context / inject 被使用过一次"的最小事件。
// 只记录使用元信息（时间 / 事件类型 / selection 参数 / 条目计数）。
// 不记录注入正文、user model 条目内容、或任何推断结论。
// 与 user model 完全分开存储；不参与 import / suggest / save / write 流程。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SelectionStrategy } from './context.js';

// 单条 observation 的最小必要元信息。
// 刻意不含：注入文本、user model 条目、任何推断结论。
export interface RuntimeObservation {
  id: string;
  timestamp: string;               // ISO8601
  event_type: 'inject' | 'context';
  agent?: string;                  // inject 路径下有效
  scope?: string;
  task_hint?: string;
  selection_strategy: SelectionStrategy;
  selected_entries: number;
  total_entries: number;
}

export interface ObservationLog {
  version: '0.1';
  observations: RuntimeObservation[];
}

// 最多保留的观察记录数量（滚动截断）
const MAX_OBSERVATIONS = 100;

// 路径在每次调用时动态计算，使 process.env.HOME 覆盖在测试中生效。
function getCortexDir(): string {
  return path.join(os.homedir(), '.cortex');
}

export function getObservationsPath(): string {
  return path.join(getCortexDir(), 'observations.json');
}

function ensureDir(): void {
  const dir = getCortexDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function emptyLog(): ObservationLog {
  return { version: '0.1', observations: [] };
}

export function loadObservationLog(): ObservationLog {
  const obsPath = getObservationsPath();
  if (!fs.existsSync(obsPath)) {
    return emptyLog();
  }
  try {
    const raw = fs.readFileSync(obsPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).version === '0.1' &&
      Array.isArray((parsed as Record<string, unknown>).observations)
    ) {
      return parsed as ObservationLog;
    }
  } catch {
    // 损坏时返回空日志，下次写入会覆盖
  }
  return emptyLog();
}

// 原子写入：同 user model 的临时文件 + rename 策略。
function saveObservationLog(log: ObservationLog): void {
  ensureDir();
  const json = JSON.stringify(log, null, 2) + '\n';
  const obsPath = getObservationsPath();
  const tmpPath = `${obsPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, obsPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // 清理失败不覆盖原始错误
    }
    throw err;
  }
}

export interface AppendObservationOptions {
  event_type: 'inject' | 'context';
  agent?: string;
  scope?: string;
  task_hint?: string;
  selection_strategy: SelectionStrategy;
  selected_entries: number;
  total_entries: number;
}

// 追加一条 observation；fail-soft：写入失败时向 stderr 打印警告，不抛出。
// 主命令成功路径不应因 observation 写入失败而崩溃。
export function appendObservation(opts: AppendObservationOptions): void {
  const obs: RuntimeObservation = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: opts.event_type,
    selection_strategy: opts.selection_strategy,
    selected_entries: opts.selected_entries,
    total_entries: opts.total_entries,
  };
  if (opts.agent !== undefined) obs.agent = opts.agent;
  if (opts.scope !== undefined) obs.scope = opts.scope;
  if (opts.task_hint !== undefined) obs.task_hint = opts.task_hint;

  try {
    const log = loadObservationLog();
    log.observations.push(obs);
    // 滚动截断，只保留最新 MAX_OBSERVATIONS 条
    if (log.observations.length > MAX_OBSERVATIONS) {
      log.observations = log.observations.slice(-MAX_OBSERVATIONS);
    }
    saveObservationLog(log);
  } catch (err) {
    console.error(`[cortex] observation 写入失败（不影响主功能）：${(err as Error).message}`);
  }
}

// CT-0015: Observation recap — 基于已有记录的轻量摘要，不引入推断或写回。
export interface ObservationRecap {
  total: number;
  contextCount: number;
  injectCount: number;
  allCount: number;
  scopedCount: number;
  topScope: string | undefined;  // 最高频 scope（scoped 记录中）
  hasTaskHint: boolean;
}

export function buildRecap(observations: RuntimeObservation[]): ObservationRecap {
  let contextCount = 0;
  let injectCount = 0;
  let allCount = 0;
  let scopedCount = 0;
  let hasTaskHint = false;
  const scopeFreq: Record<string, number> = {};

  for (const obs of observations) {
    if (obs.event_type === 'context') contextCount++; else injectCount++;
    if (obs.selection_strategy === 'all') allCount++; else scopedCount++;
    if (obs.task_hint) hasTaskHint = true;
    if (obs.scope) scopeFreq[obs.scope] = (scopeFreq[obs.scope] ?? 0) + 1;
  }

  let topScope: string | undefined;
  const scopeEntries = Object.entries(scopeFreq);
  if (scopeEntries.length > 0) {
    topScope = scopeEntries.sort((a, b) => b[1] - a[1])[0][0];
  }

  return { total: observations.length, contextCount, injectCount, allCount, scopedCount, topScope, hasTaskHint };
}

export function renderRecap(recap: ObservationRecap): string {
  if (recap.total === 0) return '';

  const lines: string[] = ['[使用摘要]', ''];
  lines.push(`  共 ${recap.total} 条记录`);

  const typeParts: string[] = [];
  if (recap.contextCount > 0) typeParts.push(`context ${recap.contextCount} 次`);
  if (recap.injectCount > 0) typeParts.push(`inject ${recap.injectCount} 次`);
  lines.push(`  事件类型：${typeParts.join(' / ')}`);

  const modeParts: string[] = [];
  if (recap.allCount > 0) modeParts.push(`全量 ${recap.allCount} 次`);
  if (recap.scopedCount > 0) modeParts.push(`聚焦 ${recap.scopedCount} 次`);
  lines.push(`  使用模式：${modeParts.join(' / ')}`);

  if (recap.topScope !== undefined) lines.push(`  最常用 scope：${recap.topScope}`);
  if (recap.hasTaskHint) lines.push('  曾使用 task-hint');

  return lines.join('\n');
}

// Human-facing 渲染：把单条 observation 格式化为可读行。
export function renderObservation(obs: RuntimeObservation): string {
  const dt = new Date(obs.timestamp).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts: string[] = [`[${dt}]`, obs.event_type];
  if (obs.agent) parts.push(`agent=${obs.agent}`);

  const modeTag = obs.selection_strategy === 'scoped' ? '聚焦' : '全量';
  parts.push(`模式=${modeTag}`);

  if (obs.scope) parts.push(`scope=${obs.scope}`);
  if (obs.task_hint) parts.push(`task-hint=${obs.task_hint}`);
  parts.push(`条目=${obs.selected_entries}/${obs.total_entries}`);

  return parts.join('  ');
}
