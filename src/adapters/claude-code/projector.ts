// Claude Code Adapter Projector (CT-0010)
//
// 角色：
//   把 InjectionPack v0.1 投影为 Claude Code 适合消费的注入内容。
//   这是 adapter 层直接消费 InjectionPack 的入口，而不是先渲染整段 text 再做处理。
//
// 分层：
//   - InjectionPack builder（injection-pack.ts）：负责从 user model 产出结构化 pack
//   - 本文件（projector）：负责把 pack 转成 Claude Code 注入内容
//   - CLI 层（index.ts）：只负责调用与输出
//
// 与旧 text 路径的关系：
//   旧路径（CT-0008）：UserModel → RuntimeContext/UserSnapshot → renderInjectionForClaudeCode → text
//   新路径（CT-0010）：UserModel → InjectionPack → projectPackForClaudeCode → ClaudeCodeProjection
//   两条路径的 instruction_text 输出格式相近，但新路径直接消费 pack 的结构化条目与 bucket 视图。

import type {
  InjectionPack,
  InjectionEntry,
  InjectionEntryKind,
} from '../../core/runtime/injection-pack.js';
import type { ObservationRecap } from '../../core/runtime/observation.js';
import { renderAgentFacingObservationRecap } from '../../core/runtime/observation-inject.js';

// CT-0012：基于 pack.source 构建 selection framing 行。
// 与 injection.ts 的 buildSelectionFraming 语义一致，但从 InjectionPackSource 读取。
function buildProjectionFraming(pack: InjectionPack): string | null {
  if (pack.source.selection_strategy !== 'scoped') return null;
  const parts: string[] = [];
  if (pack.source.scope) parts.push(`聚焦 → ${pack.source.scope}`);
  if (pack.source.task_hint) parts.push(`任务线索 → ${pack.source.task_hint}`);
  if (parts.length === 0) return null;
  return `[注入范围：${parts.join(' | ')}]`;
}

// CT-0012：把 open_questions 渲染为 agent-facing 提示行。
function renderProjectionOpenQuestions(questions: string[]): string[] {
  if (questions.length === 0) return [];
  const lines: string[] = [];
  lines.push('⚠️ 待确认问题（以下情况尚不明确，仅供参考，不阻断执行）：');
  for (const q of questions) {
    lines.push(`  - ${q}`);
  }
  return lines;
}

export interface ClaudeCodeSection {
  kind: InjectionEntryKind;
  heading: string;
  entries: InjectionEntry[];
  rendered_lines: string[];
}

export interface ClaudeCodeProjection {
  agent: 'claude-code';
  generated_at: string;
  pack_version: string;
  sections: ClaudeCodeSection[];
  instruction_text: string;
  entry_count: number;
}

const KIND_HEADINGS: Record<InjectionEntryKind, string> = {
  project: '📌 当前参与项目：',
  goal: '🎯 核心目标（你的规划必须服务于这些目标）：',
  constraint: '⛔ 绝对约束（修改代码或执行操作时严禁违反）：',
  preference: '💡 偏好与习惯（请尽量贴合此风格）：',
  decision_rule: '⚖️ 决策规则（在遇到特定分支时自动适用）：',
  skill: '👤 技能水平：',
  state: '📍 当前状态：',
};

// 与旧渲染器保持相同的展示顺序（skill / state 置后）
const SECTION_ORDER: InjectionEntryKind[] = [
  'project',
  'goal',
  'constraint',
  'preference',
  'decision_rule',
  'skill',
  'state',
];

function renderEntry(entry: InjectionEntry): string {
  if (entry.kind === 'decision_rule') {
    const d = entry.details ?? {};
    const when = typeof d.when === 'string' ? d.when : null;
    const then = typeof d.then === 'string' ? d.then : null;
    if (when && then) {
      return `  - ${entry.content}（当：${when} → 则：${then}）`;
    }
  }
  return `  - ${entry.content}`;
}

function buildSection(
  kind: InjectionEntryKind,
  entries: InjectionEntry[]
): ClaudeCodeSection {
  return {
    kind,
    heading: KIND_HEADINGS[kind],
    entries,
    rendered_lines: entries.map(renderEntry),
  };
}

export interface ClaudeCodeProjectionOptions {
  recap?: ObservationRecap;
}

export function projectPackForClaudeCode(
  pack: InjectionPack,
  options: ClaudeCodeProjectionOptions = {}
): ClaudeCodeProjection {
  const buckets: Record<InjectionEntryKind, InjectionEntry[]> = {
    project: pack.projects,
    goal: pack.goals,
    preference: pack.preferences,
    constraint: pack.constraints,
    skill: pack.skills,
    state: pack.states,
    decision_rule: pack.decision_rules,
  };

  const sections: ClaudeCodeSection[] = [];
  for (const kind of SECTION_ORDER) {
    const entries = buckets[kind];
    if (entries.length > 0) {
      sections.push(buildSection(kind, entries));
    }
  }

  const lines: string[] = [];
  lines.push('<cortex-user-model-injection>');
  lines.push('【Cortex 系统级指令：长期项目与用户上下文】');
  lines.push(
    '你正在服务当前终端的用户。在接下来的规划、代码修改和工具使用中，必须优先参考以下上下文。当遇到信息不足时，请将本列表作为你的核心约束边界，切勿自行臆断。'
  );

  // CT-0012：selection framing（scoped 模式下显示聚焦范围）
  const framing = buildProjectionFraming(pack);
  if (framing) {
    lines.push('');
    lines.push(framing);
  }

  // CT-0019: observation recap injection
  if (options.recap) {
    const recapLines = renderAgentFacingObservationRecap(options.recap);
    if (recapLines) {
      lines.push('');
      lines.push(recapLines);
    }
  }

  lines.push('');

  for (const section of sections) {
    lines.push(section.heading);
    for (const line of section.rendered_lines) {
      lines.push(line);
    }
    lines.push('');
  }

  // CT-0012：open_questions（scoped 选择存在歧义时向 agent 提示）
  const oqLines = renderProjectionOpenQuestions(pack.open_questions);
  if (oqLines.length > 0) {
    for (const l of oqLines) lines.push(l);
    lines.push('');
  }

  lines.push(
    '(注：以上内容是持久化的跨环境用户状态，优先于本次会话中的随意表述。)'
  );
  lines.push('</cortex-user-model-injection>');

  return {
    agent: 'claude-code',
    generated_at: pack.generated_at,
    pack_version: pack.version,
    sections,
    instruction_text: lines.join('\n'),
    entry_count: pack.user_summary.total_entries,
  };
}
