// Runtime Context
//
// 分两层：
//   1. selectRuntimeContext(model, options) -> RuntimeContext
//      结构化对象，决定"把 user model 的哪些部分交给 agent"。
//      当前仅实现 selectionStrategy = "all"。
//   2. renderPromptContext(ctx) -> string
//      把 RuntimeContext 转成可直接拼进 prompt 的中文文本。
//
// 这样做的原因：
//   - 选择策略（scope / agent / ranking）与文本格式是两个独立维度，
//     混在一起会让后续的 per-agent templating / token 预算无从下手。
//   - 下游可以只消费结构化对象，不必依赖字符串格式。

import type {
  UserModel,
  Project,
  Goal,
  Preference,
  Constraint,
  Skill,
  State,
  DecisionRule,
  ISO8601,
  BaseItem,
} from '../user-model/types.js';

export type SelectionStrategy = 'all' | 'manual' | 'scoped' | 'ranked';

export interface RuntimeContextOptions {
  agent?: string;
  taskHint?: string;
  // 预留：未来可加 scope / itemIds / maxItems 等
}

export interface UserSnapshot {
  projects: Project[];
  goals: Goal[];
  preferences: Preference[];
  constraints: Constraint[];
  skills: Skill[];
  states: State[];
  decision_rules: DecisionRule[];
}

export interface RuntimeContextMeta {
  source_schema_version: string;
  selection_strategy: SelectionStrategy;
  notes?: string;
}

export interface RuntimeContext {
  schema_version: '0.1';
  generated_at: ISO8601;
  agent?: string;
  task_hint?: string;
  user_snapshot: UserSnapshot;
  meta: RuntimeContextMeta;
}

// 选择层：当前策略固定为 "all"，直接把 user model 的所有条目原样搬过来。
// options 里的 agent / taskHint 目前只作为元数据带下去，不影响选择。
export function selectRuntimeContext(
  model: UserModel,
  options: RuntimeContextOptions = {}
): RuntimeContext {
  const snapshot: UserSnapshot = {
    projects: [...model.projects],
    goals: [...model.goals],
    preferences: [...model.preferences],
    constraints: [...model.constraints],
    skills: [...model.skills],
    states: [...model.states],
    decision_rules: [...model.decision_rules],
  };

  return {
    schema_version: '0.1',
    generated_at: new Date().toISOString(),
    agent: options.agent,
    task_hint: options.taskHint,
    user_snapshot: snapshot,
    meta: {
      source_schema_version: model.schema_version,
      selection_strategy: 'all',
    },
  };
}

// --- 渲染层 ---

function formatBaseItems(items: BaseItem[]): string {
  if (items.length === 0) return '  （暂无）';
  return items
    .map((item) => {
      const desc = item.description ? `：${item.description}` : '';
      return `  - ${item.label}${desc}`;
    })
    .join('\n');
}

function formatSkills(skills: Skill[]): string {
  if (skills.length === 0) return '  （暂无）';
  return skills
    .map((s) => {
      const level = s.level ? `（${s.level}）` : '';
      return `  - ${s.label}${level}`;
    })
    .join('\n');
}

function formatStates(states: State[]): string {
  if (states.length === 0) return '  （暂无）';
  return states
    .map((s) => {
      const until = s.valid_until ? `（至 ${s.valid_until}）` : '';
      return `  - ${s.label}${until}`;
    })
    .join('\n');
}

function formatRules(rules: DecisionRule[]): string {
  if (rules.length === 0) return '  （暂无）';
  return rules
    .map((r) => {
      if (r.when && r.then) {
        return `  - ${r.label}（当 ${r.when} → ${r.then}）`;
      }
      return `  - ${r.label}`;
    })
    .join('\n');
}

// 渲染层：只负责把结构化 RuntimeContext 变成中文 prompt 文本。
// 不读 UserModel，不做选择逻辑。
export function renderPromptContext(ctx: RuntimeContext): string {
  const snap = ctx.user_snapshot;
  const lines: string[] = [];

  lines.push('[User Context]');
  lines.push('');
  lines.push('项目：');
  lines.push(formatBaseItems(snap.projects));
  lines.push('');
  lines.push('目标：');
  lines.push(formatBaseItems(snap.goals));
  lines.push('');
  lines.push('偏好：');
  lines.push(formatBaseItems(snap.preferences));
  lines.push('');
  lines.push('约束：');
  lines.push(formatBaseItems(snap.constraints));
  lines.push('');
  lines.push('技能：');
  lines.push(formatSkills(snap.skills));
  lines.push('');
  lines.push('状态：');
  lines.push(formatStates(snap.states));
  lines.push('');
  lines.push('决策规则：');
  lines.push(formatRules(snap.decision_rules));

  return lines.join('\n');
}
