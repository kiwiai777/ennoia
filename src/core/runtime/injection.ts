import type { ISO8601 } from '../user-model/types.js';
import type { SelectionStrategy, UserSnapshot, RuntimeContext } from './context.js';
import { 
  selectRuntimeContext, 
  formatBaseItems,
  formatSkills,
  formatStates,
  formatRules
} from './context.js';
import type { UserModel } from '../user-model/types.js';

export interface InjectionMeta {
  selection_strategy: SelectionStrategy;
  locale: string;
  source: string;
  version: string;
}

export interface InjectionPackage {
  agent: string;
  format: 'text';
  generated_at: ISO8601;
  user_snapshot: UserSnapshot;
  instruction_text: string;
  meta: InjectionMeta;
}

// 面向 claude-code 的结构化注入渲染
// 语气偏向 coding / planning / execution
function renderInjectionForClaudeCode(ctx: RuntimeContext): string {
  const snap = ctx.user_snapshot;
  const lines: string[] = [];

  lines.push('<cortex-user-model-injection>');
  lines.push('【Cortex 系统级指令：长期项目与用户上下文】');
  lines.push('你正在服务当前终端的用户。在接下来的规划、代码修改和工具使用中，必须优先参考以下上下文。当遇到信息不足时，请将本列表作为你的核心约束边界，切勿自行臆断。');
  lines.push('');
  
  if (snap.projects.length > 0) {
    lines.push('📌 当前参与项目：');
    lines.push(formatBaseItems(snap.projects));
    lines.push('');
  }
  
  if (snap.goals.length > 0) {
    lines.push('🎯 核心目标（你的规划必须服务于这些目标）：');
    lines.push(formatBaseItems(snap.goals));
    lines.push('');
  }
  
  if (snap.constraints.length > 0) {
    lines.push('⛔ 绝对约束（修改代码或执行操作时严禁违反）：');
    lines.push(formatBaseItems(snap.constraints));
    lines.push('');
  }
  
  if (snap.preferences.length > 0) {
    lines.push('💡 偏好与习惯（请尽量贴合此风格）：');
    lines.push(formatBaseItems(snap.preferences));
    lines.push('');
  }

  if (snap.decision_rules.length > 0) {
    lines.push('⚖️ 决策规则（在遇到特定分支时自动适用）：');
    lines.push(formatRules(snap.decision_rules));
    lines.push('');
  }
  
  if (snap.skills.length > 0 || snap.states.length > 0) {
    lines.push('👤 补充用户画像（帮助你理解背景）：');
    if (snap.skills.length > 0) {
      lines.push('技能水平：');
      lines.push(formatSkills(snap.skills));
    }
    if (snap.states.length > 0) {
      lines.push('当前状态：');
      lines.push(formatStates(snap.states));
    }
    lines.push('');
  }
  
  lines.push('(注：以上内容是持久化的跨环境用户状态，优先于本次会话中的随意表述。)');
  lines.push('</cortex-user-model-injection>');
  return lines.join('\n');
}

// 面向 generic 的通用注入渲染
// 语气更像 general assistant instruction
function renderInjectionForGeneric(ctx: RuntimeContext): string {
  const snap = ctx.user_snapshot;
  const lines: string[] = [];

  lines.push('--- Cortex 长期用户模型 ---');
  lines.push('以下是该用户的跨环境长期状态与偏好。请在回答问题或提供建议时，综合考虑这些信息，不要违背用户明确的约束。');
  lines.push('');
  
  lines.push('【项目与目标】');
  lines.push(formatBaseItems([...snap.projects, ...snap.goals]));
  lines.push('');
  
  lines.push('【偏好与约束】');
  lines.push(formatBaseItems([...snap.preferences, ...snap.constraints]));
  lines.push('');
  
  if (snap.decision_rules.length > 0) {
    lines.push('【决策规则】');
    lines.push(formatRules(snap.decision_rules));
    lines.push('');
  }
  
  if (snap.skills.length > 0 || snap.states.length > 0) {
    lines.push('【补充信息】');
    lines.push(formatSkills(snap.skills));
    lines.push(formatStates(snap.states));
  }
  
  return lines.join('\n');
}

// 独立的 injection render 函数
function renderInjectionInstruction(ctx: RuntimeContext): string {
  if (ctx.agent === 'claude-code') {
    return renderInjectionForClaudeCode(ctx);
  }
  return renderInjectionForGeneric(ctx);
}

export function createInjectionPackage(
  model: UserModel,
  agentId: string = 'generic',
  locale: string = 'zh'
): InjectionPackage {
  // 1. selection layer
  const ctx = selectRuntimeContext(model, { agent: agentId });
  
  // 2. rendering layer (agent-aware)
  const instruction_text = renderInjectionInstruction(ctx);

  return {
    agent: agentId,
    format: 'text',
    generated_at: new Date().toISOString(),
    user_snapshot: ctx.user_snapshot,
    instruction_text,
    meta: {
      selection_strategy: ctx.meta.selection_strategy,
      locale,
      source: 'cortex:runtime-injection',
      version: '0.1'
    }
  };
}
