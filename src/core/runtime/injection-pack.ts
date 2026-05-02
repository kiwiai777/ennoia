// Structured Injection Pack v0.1
//
// 角色：
//   把 user model 转换为一个稳定、可消费的结构化注入包（InjectionPack）。
//   它不是“自动注入到 agent runtime”的载体，而是一个明确的、agent / adapter
//   可以直接读取的中间表达。CLI 的 --format json 输出就是它。
//
// 与 CT-0008 InjectionPackage 的关系：
//   - InjectionPackage（CT-0008）面向"渲染好的注入文本 + 元数据"，主体是 instruction_text。
//   - InjectionPack（本模块）面向"结构化条目 + 派生分桶"，主体是 entries 与 buckets。
//   - 二者并存：text 路径继续用 InjectionPackage；json 路径用 InjectionPack。
//
// 分层：
//   - 本文件只负责 schema 定义 + 由 RuntimeContext 派生 pack（builder）。
//   - 文本渲染保持在 injection.ts。
//   - JSON 序列化保持在 CLI / exporter（buildInjectionPack 已经返回纯数据，
//     直接 JSON.stringify 即可，不需要专门的序列化层）。
//
// 边界（CT-0009 明确不做）：
//   - 不做 task-aware / scoped 选择
//   - 不做 ranking
//   - 不做自动注入 / hooks / runtime 挂载
//   - 不引入新的 user model 字段，只如实映射现有数据

import type {
  UserModel,
  ISO8601,
  Project,
  Goal,
  Preference,
  Constraint,
  Skill,
  State,
  DecisionRule,
  BaseItem,
} from '../user-model/types.js';
import {
  selectRuntimeContext,
  type SelectionStrategy,
  type UserSnapshot,
} from './context.js';

export const INJECTION_PACK_VERSION = '0.1' as const;
export const CORTEX_GENERATOR = 'cortex' as const;
export const CORTEX_GENERATOR_VERSION = '0.1' as const;

export type InjectionEntryKind =
  | 'project'
  | 'goal'
  | 'preference'
  | 'constraint'
  | 'skill'
  | 'state'
  | 'decision_rule';

// 单条 entry：保持来自 user model 的最小数据契约。
// details 用于承载 kind-specific 字段（如 decision_rule.when/then），
// 避免在顶层加一堆只对某个 kind 才有意义的可空字段。
export interface InjectionEntry {
  id: string;
  kind: InjectionEntryKind;
  content: string;
  provenance: string | null;
  confirmed: boolean;
  created_at: ISO8601;
  updated_at: ISO8601;
  details?: Record<string, unknown>;
}

export interface InjectionPackSource {
  generator: typeof CORTEX_GENERATOR;
  generator_version: typeof CORTEX_GENERATOR_VERSION;
  user_model_schema_version: string;
  agent: string;
  selection_strategy: SelectionStrategy;
  // CT-0011：scoped 模式下体现 scope / task_hint 参与情况
  scope?: string;
  task_hint?: string;
}

export interface InjectionPackInstructions {
  // 一段总括性的、克制的注入说明文本。下游 agent 可以原样附在 prompt 中。
  text: string;
  // 拆成几条短规则，方便 agent / adapter 单独引用。
  notes: string[];
}

export interface InjectionPackSummary {
  total_entries: number;
  counts: Record<InjectionEntryKind, number>;
}

// 结构化注入包 v0.1。
//
// 关键约定：
//   - entries 是“权威”主结构；所有按 kind 分类的桶均派生自 entries。
//   - 桶字段在该 kind 没有数据时是空数组（不是 null / 不缺失），保证消费方稳定。
//   - open_questions 当前永远是 []，为后续 scoped / task-aware 设计预留。
export interface InjectionPack {
  version: typeof INJECTION_PACK_VERSION;
  generated_at: ISO8601;
  source: InjectionPackSource;
  user_summary: InjectionPackSummary;
  entries: InjectionEntry[];
  // 按 kind 分类的派生视图（与 entries 一致，仅按 kind 切片）。
  projects: InjectionEntry[];
  goals: InjectionEntry[];
  preferences: InjectionEntry[];
  constraints: InjectionEntry[];
  skills: InjectionEntry[];
  states: InjectionEntry[];
  decision_rules: InjectionEntry[];
  open_questions: string[];
  instructions: InjectionPackInstructions;
}

export interface BuildInjectionPackOptions {
  agent?: string;
  // CT-0011：scope / taskHint 触发 scoped 选择策略（无需显式设置 selectionStrategy）
  scope?: string;
  taskHint?: string;
  selectionStrategy?: SelectionStrategy;
}

// 把 BaseItem 中可选的 description 折进 content：
//   - 有 description：`label：description`
//   - 无 description：`label`
// 这样下游不必再为空 description 分支处理。
function joinContent(item: BaseItem): string {
  if (item.description && item.description.trim() !== '') {
    return `${item.label}：${item.description}`;
  }
  return item.label;
}

// 仅保留 kind-specific 且“有值”的字段，避免输出一堆 undefined。
// 不做归一化重命名，下游可以按字段名直接对应到 user model 类型。
function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function makeEntry(
  item: { id: string; source?: string; created_at: string; updated_at: string; label: string; description?: string },
  kind: InjectionEntryKind,
  details: Record<string, unknown> = {}
): InjectionEntry {
  const cleaned = pickDefined(details);
  const entry: InjectionEntry = {
    id: item.id,
    kind,
    content: joinContent(item),
    provenance: item.source ?? null,
    // user model 中存在的条目都是用户确认过的（CT-0004 起的写入语义）。
    // 这里硬编码为 true，避免引入“伪 confirmed 字段”。
    confirmed: true,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
  if (Object.keys(cleaned).length > 0) {
    entry.details = cleaned;
  }
  return entry;
}

function entriesFromSnapshot(snapshot: UserSnapshot): InjectionEntry[] {
  const out: InjectionEntry[] = [];
  for (const p of snapshot.projects as Project[]) {
    out.push(makeEntry(p, 'project', { status: p.status }));
  }
  for (const g of snapshot.goals as Goal[]) {
    out.push(makeEntry(g, 'goal', { horizon: g.horizon }));
  }
  for (const pr of snapshot.preferences as Preference[]) {
    out.push(makeEntry(pr, 'preference', { applies_to: pr.applies_to }));
  }
  for (const c of snapshot.constraints as Constraint[]) {
    out.push(makeEntry(c, 'constraint', { severity: c.severity }));
  }
  for (const s of snapshot.skills as Skill[]) {
    out.push(makeEntry(s, 'skill', { level: s.level }));
  }
  for (const st of snapshot.states as State[]) {
    out.push(makeEntry(st, 'state', { valid_until: st.valid_until }));
  }
  for (const r of snapshot.decision_rules as DecisionRule[]) {
    out.push(makeEntry(r, 'decision_rule', { when: r.when, then: r.then }));
  }
  return out;
}

function bucketBy(
  entries: InjectionEntry[],
  kind: InjectionEntryKind
): InjectionEntry[] {
  return entries.filter((e) => e.kind === kind);
}

// instructions 字段刻意保持克制：
//   - 只表达"这是已确认的长期用户特征"
//   - 明确"当前任务以用户当下指令为准"
//   - 不写成强制性的 agent policy / behavior controller
function defaultInstructions(): InjectionPackInstructions {
  const notes = [
    '以下条目来自 Cortex 用户模型，是已经过用户确认的长期特征。',
    '它们描述的是用户的稳定背景，不等同于当前任务的具体要求。',
    '当前任务仍应以用户当下明确请求为准；本注入只是补充上下文。',
    '当本注入与用户当前显式指令冲突时，以当前指令为准。',
  ];
  return {
    text: notes.join('\n'),
    notes,
  };
}

// 由 UserModel 构建 InjectionPack。
//
// 实现路径：复用 selectRuntimeContext 拿到 UserSnapshot，
// 这样选择层（当前固定 'all'）和 pack builder 共享一个数据来源，
// 后续要做 scoped / ranked 时只改 selectRuntimeContext 一处。
export function buildInjectionPack(
  model: UserModel,
  options: BuildInjectionPackOptions = {}
): InjectionPack {
  const agent = options.agent ?? 'generic';
  // CT-0011：scope / taskHint 传入 selectRuntimeContext，共享同一选择层。
  const ctx = selectRuntimeContext(model, {
    agent,
    scope: options.scope,
    taskHint: options.taskHint,
  });

  const entries = entriesFromSnapshot(ctx.user_snapshot);

  const counts: Record<InjectionEntryKind, number> = {
    project: 0,
    goal: 0,
    preference: 0,
    constraint: 0,
    skill: 0,
    state: 0,
    decision_rule: 0,
  };
  for (const e of entries) counts[e.kind] += 1;

  const source: InjectionPackSource = {
    generator: CORTEX_GENERATOR,
    generator_version: CORTEX_GENERATOR_VERSION,
    user_model_schema_version: ctx.meta.source_schema_version,
    agent,
    selection_strategy: ctx.meta.selection_strategy,
  };
  if (ctx.meta.scope) source.scope = ctx.meta.scope;
  if (ctx.meta.task_hint) source.task_hint = ctx.meta.task_hint;

  return {
    version: INJECTION_PACK_VERSION,
    generated_at: new Date().toISOString(),
    source,
    user_summary: {
      total_entries: entries.length,
      counts,
    },
    entries,
    projects: bucketBy(entries, 'project'),
    goals: bucketBy(entries, 'goal'),
    preferences: bucketBy(entries, 'preference'),
    constraints: bucketBy(entries, 'constraint'),
    skills: bucketBy(entries, 'skill'),
    states: bucketBy(entries, 'state'),
    decision_rules: bucketBy(entries, 'decision_rule'),
    // CT-0011：从 selectRuntimeContext 传递真实 open_questions，不再永远为空。
    open_questions: ctx.open_questions,
    instructions: defaultInstructions(),
  };
}

// 把 InjectionPack 序列化为稳定 JSON 字符串。
//   - 默认带 2-space 缩进，方便人读 + diff 友好
//   - 不做字段顺序硬编码：依赖 buildInjectionPack 的对象字面量顺序
//
// 单独提供函数是为了让 CLI / adapter 不直接依赖 JSON.stringify 选项细节。
export function serializeInjectionPack(pack: InjectionPack): string {
  return JSON.stringify(pack, null, 2);
}
