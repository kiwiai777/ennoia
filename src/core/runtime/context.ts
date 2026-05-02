// Runtime Context
//
// 分两层：
//   1. selectRuntimeContext(model, options) -> RuntimeContext
//      结构化对象，决定"把 user model 的哪些部分交给 agent"。
//      CT-0011 起支持 scope / task-hint 驱动的 scoped 选择。
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
  // CT-0011：显式 scope 字符串，触发 scoped 选择策略。
  scope?: string;
  // 选择策略；当前支持 "all"（默认）和 "scoped"（有 scope/taskHint 时自动启用）。
  selectionStrategy?: SelectionStrategy;
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
  // CT-0011 scoped 模式下填充的字段
  scope?: string;
  task_hint?: string;
  matched_project_ids?: string[];
  total_model_entries: number;
  selected_entries: number;
  notes?: string;
}

export interface RuntimeContext {
  schema_version: '0.1';
  generated_at: ISO8601;
  agent?: string;
  task_hint?: string;
  user_snapshot: UserSnapshot;
  // CT-0011：表达选择过程中发现的歧义或不足，不再永远为空。
  open_questions: string[];
  meta: RuntimeContextMeta;
}

function countModelEntries(model: UserModel): number {
  return (
    model.projects.length +
    model.goals.length +
    model.preferences.length +
    model.constraints.length +
    model.skills.length +
    model.states.length +
    model.decision_rules.length
  );
}

// CT-0027-04: 过滤 active 条目
function filterActive<T extends BaseItem>(items: T[]): T[] {
  return items.filter(item => (item.status ?? 'active') === 'active');
}

function countSnapshotEntries(snap: UserSnapshot): number {
  return (
    snap.projects.length +
    snap.goals.length +
    snap.preferences.length +
    snap.constraints.length +
    snap.skills.length +
    snap.states.length +
    snap.decision_rules.length
  );
}

// CT-0011 scoped selection：
//   - scope 用于匹配项目（label/id），过滤与之关联的 goals/skills/states。
//   - taskHint 用于轻量文本匹配，补充 scope 未命中的条目。
//   - preferences / constraints / decision_rules 永远全量包含（全局上下文）。
//   - 歧义 / 缺失情况写入 open_questions。
function buildScopedSnapshot(
  model: UserModel,
  scope: string | undefined,
  taskHint: string | undefined
): {
  snapshot: UserSnapshot;
  open_questions: string[];
  matched_project_ids: string[];
} {
  const open_questions: string[] = [];
  let matched_project_ids: string[] = [];

  // 1. Project matching by scope
  let selectedProjects: Project[];
  if (scope) {
    const s = scope.toLowerCase();
    const matched = filterActive(model.projects).filter(
      (p) =>
        p.label.toLowerCase().includes(s) || p.id.toLowerCase().includes(s)
    );
    if (matched.length === 0) {
      open_questions.push(
        `scope "${scope}" 未匹配到任何已知项目，已返回全部项目供参考`
      );
      selectedProjects = [...model.projects];
    } else {
      if (matched.length > 1) {
        open_questions.push(
          `scope "${scope}" 匹配到多个项目：${matched.map((p) => p.label).join('、')}`
        );
      }
      selectedProjects = matched;
      matched_project_ids = matched.map((p) => p.id);
    }
  } else {
    selectedProjects = [...model.projects];
  }

  // 2. Task-hint keywords（跳过单字符 token）
  const hintKeywords =
    taskHint
      ?.toLowerCase()
      .split(/[\s,，、]+/)
      .filter((w) => w.length > 1) ?? [];

  function matchesHint(item: BaseItem): boolean {
    if (hintKeywords.length === 0) return false;
    const text = `${item.label} ${item.description ?? ''}`.toLowerCase();
    return hintKeywords.some((k) => text.includes(k));
  }

  // item 属于已匹配项目，或没有明确 scope（全局），或 scope === 'global'。
  // 只在 scope 实际命中了项目时才有效；hint-only 模式下不调用。
  function matchesScope(item: BaseItem): boolean {
    return (
      !item.scope ||
      item.scope === 'global' ||
      matched_project_ids.includes(item.scope)
    );
  }

  // 3. Filter goals / skills / states
  //
  // 两种模式：
  //   - 有 scope 命中（matched_project_ids 非空）：scope OR hint 任一命中即入选。
  //   - 仅 hint（matched_project_ids 为空）：仅 hint 命中才入选，不全量包含。
  //     这样 task-hint 单独使用时才能形成真实过滤，而不是名义 scoped。
  const hasScopeFilter = matched_project_ids.length > 0;

  function selectItem(item: BaseItem): boolean {
    if (hasScopeFilter) return matchesScope(item) || matchesHint(item);
    return matchesHint(item);
  }

  const selectedGoals = filterActive(model.goals).filter(selectItem);
  const selectedSkills = filterActive(model.skills).filter(selectItem);
  const selectedStates = filterActive(model.states).filter(selectItem);

  // 4. Open questions for task-hint
  if (taskHint && hintKeywords.length > 0) {
    const hintMatchCount = [
      ...selectedGoals,
      ...selectedSkills,
      ...selectedStates,
    ].filter(matchesHint).length;
    if (hintMatchCount === 0) {
      open_questions.push(
        `task-hint "${taskHint}" 未能匹配到任何具体条目，当前 user model 中可能缺少相关信息`
      );
    }
  }

  // preferences / constraints / decision_rules 全量保留（全局上下文）
  const snapshot: UserSnapshot = {
    projects: selectedProjects,
    goals: selectedGoals,
    preferences: [...model.preferences],
    constraints: [...model.constraints],
    skills: selectedSkills,
    states: selectedStates,
    decision_rules: [...model.decision_rules],
  };

  return { snapshot, open_questions, matched_project_ids };
}

// 选择层（CT-0011）：
//   - 无 scope / taskHint → strategy = 'all'，行为与 CT-0009 一致。
//   - 有 scope 或 taskHint → strategy = 'scoped'，触发可解释规则过滤。
//   - 三条输出路径（text / json / claude-code projector）共享同一选择结果。
export function selectRuntimeContext(
  model: UserModel,
  options: RuntimeContextOptions = {}
): RuntimeContext {
  const { agent, taskHint, scope } = options;
  const hasInput = Boolean(scope || taskHint);
  const strategy: SelectionStrategy = hasInput ? 'scoped' : 'all';

  const total = countModelEntries(model);

  if (!hasInput) {
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
      agent,
      task_hint: taskHint,
      user_snapshot: snapshot,
      open_questions: [],
      meta: {
        source_schema_version: model.schema_version,
        selection_strategy: 'all',
        total_model_entries: total,
        selected_entries: total,
      },
    };
  }

  const { snapshot, open_questions, matched_project_ids } = buildScopedSnapshot(
    model,
    scope,
    taskHint
  );
  const selected = countSnapshotEntries(snapshot);

  return {
    schema_version: '0.1',
    generated_at: new Date().toISOString(),
    agent,
    task_hint: taskHint,
    user_snapshot: snapshot,
    open_questions,
    meta: {
      source_schema_version: model.schema_version,
      selection_strategy: strategy,
      scope,
      task_hint: taskHint,
      matched_project_ids:
        matched_project_ids.length > 0 ? matched_project_ids : undefined,
      total_model_entries: total,
      selected_entries: selected,
    },
  };
}

// --- 渲染层 ---

export function formatBaseItems(items: BaseItem[]): string {
  if (items.length === 0) return '  （暂无）';
  return items
    .map((item) => {
      const desc = item.description ? `：${item.description}` : '';
      return `  - ${item.label}${desc}`;
    })
    .join('\n');
}

export function formatSkills(skills: Skill[]): string {
  if (skills.length === 0) return '  （暂无）';
  return skills
    .map((s) => {
      const level = s.level ? `（${s.level}）` : '';
      return `  - ${s.label}${level}`;
    })
    .join('\n');
}

export function formatStates(states: State[]): string {
  if (states.length === 0) return '  （暂无）';
  return states
    .map((s) => {
      const until = s.valid_until ? `（至 ${s.valid_until}）` : '';
      return `  - ${s.label}${until}`;
    })
    .join('\n');
}

export function formatRules(rules: DecisionRule[]): string {
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

// TODO: 支持多语言渲染（zh / en）。当前默认中文；
// 后续可在 renderContextForHuman 增加 locale 参数或拆出 renderEn()。
// 渲染层：只负责把结构化 RuntimeContext 变成中文 prompt 文本。
// 不读 UserModel，不做选择逻辑。

// CT-0013：human-facing selection summary。
// scoped 模式下显示当前聚焦范围与条目计数，帮助 owner 核查"为什么不是全量"。
// all 模式返回 null，不输出任何多余行。
function buildHumanSelectionSummary(ctx: RuntimeContext): string | null {
  if (ctx.meta.selection_strategy !== 'scoped') return null;
  const lines: string[] = [];
  lines.push('[当前上下文范围]');
  lines.push('  模式：聚焦（非全量）');
  if (ctx.meta.scope) lines.push(`  聚焦项目：${ctx.meta.scope}`);
  if (ctx.meta.task_hint) lines.push(`  任务线索：${ctx.meta.task_hint}`);
  lines.push(`  已选条目：${ctx.meta.selected_entries} / ${ctx.meta.total_model_entries}`);
  return lines.join('\n');
}

// CT-0013：open_questions 的 human-facing 呈现。
// 表达"当前理解可能仍需补充确认"，不制造系统报错感。
function renderHumanOpenQuestions(questions: string[]): string | null {
  if (questions.length === 0) return null;
  const lines: string[] = [];
  lines.push('[待确认信息]');
  lines.push('  以下情况当前尚不明确，供参考，不影响执行：');
  for (const q of questions) {
    lines.push(`  - ${q}`);
  }
  return lines.join('\n');
}

export function renderContextForHuman(ctx: RuntimeContext): string {
  const snap = ctx.user_snapshot;
  const lines: string[] = [];

  // CT-0013：scoped 模式下先输出 selection summary
  const selectionSummary = buildHumanSelectionSummary(ctx);
  if (selectionSummary) {
    lines.push(selectionSummary);
    lines.push('');
  }

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

  // CT-0013：open_questions 在内容之后输出
  const oqBlock = renderHumanOpenQuestions(ctx.open_questions);
  if (oqBlock) {
    lines.push('');
    lines.push(oqBlock);
  }

  return lines.join('\n');
}
