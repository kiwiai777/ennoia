// User Model v0.1 类型定义
// 对齐 spec：ai-project-os/2_projects/cortex/docs/spec/user-model/v0.1.md
// 原则：保持最小、可读、易修改。复杂规则延后到后续版本。

export type ISO8601 = string;

// scope 可为 'global' 或某个项目 id
export type Scope = 'global' | string;

export type ProjectStatus = 'active' | 'paused' | 'archived';
export type GoalHorizon = 'short' | 'mid' | 'long';
export type Severity = 'hard' | 'soft';
export type SkillLevel = 'novice' | 'intermediate' | 'advanced' | 'expert';

// 所有条目共享的基础字段
export interface BaseItem {
  id: string;
  label: string;
  description?: string;
  scope?: Scope;
  source?: string;
  confidence?: number;
  created_at: ISO8601;
  updated_at: ISO8601;
}

export interface Project extends BaseItem {
  status?: ProjectStatus;
}

export interface Goal extends BaseItem {
  horizon?: GoalHorizon;
}

export interface Preference extends BaseItem {
  applies_to?: string;
}

export interface Constraint extends BaseItem {
  severity?: Severity;
}

export interface Skill extends BaseItem {
  level?: SkillLevel;
}

export interface State extends BaseItem {
  valid_until?: ISO8601;
}

// 决策规则：自然语言先行，结构化执行形式延后
export interface DecisionRule extends BaseItem {
  when?: string;
  then?: string;
}

export interface Meta {
  last_updated: ISO8601 | null;
  sources: string[];
  confidence: number | null;
}

export interface UserModel {
  schema_version: '0.1';
  projects: Project[];
  goals: Goal[];
  preferences: Preference[];
  constraints: Constraint[];
  skills: Skill[];
  states: State[];
  decision_rules: DecisionRule[];
  meta: Meta;
}

// 返回一个空的 user model（用于初始化）
export function emptyUserModel(): UserModel {
  return {
    schema_version: '0.1',
    projects: [],
    goals: [],
    preferences: [],
    constraints: [],
    skills: [],
    states: [],
    decision_rules: [],
    meta: {
      last_updated: null,
      sources: [],
      confidence: null,
    },
  };
}
