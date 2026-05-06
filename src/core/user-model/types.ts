// User Model v0.2 ���型定��
// ��齐 spec：ai-project-os/2_projects/cortex/docs/spec/user-model/v0.1.md
// 原则��保持最��、可���、易修改��复杂���则延��到后续��本。
// CT-0027-04: ���展 embedding 持久化 + 软删���

export type ISO8601 = string;

// scope 可为 'global' 或某��项目 id
export type Scope = 'global' | string;

export type ProjectStatus = 'active' | 'paused' | 'archived';
export type GoalHorizon = 'short' | 'mid' | 'long';
export type Severity = 'hard' | 'soft';
export type SkillLevel = 'novice' | 'intermediate' | 'advanced' | 'expert';

// 所有条��共享���基础字段
export interface BaseItem {
  id: string;
  label: string;
  description?: string;
  scope?: Scope;
  source?: string;
  confidence?: number;
  created_at: ISO8601;
  updated_at: ISO8601;
  // CT-0027-04: embedding 持久化 + ��删除
  embedding?: number[];
  embedding_model?: string;
  status?: 'active' | 'superseded';
  superseded_by?: string;
  superseded_at?: ISO8601;
}

export interface Project extends Omit<BaseItem, 'status'> {
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

// 决���规则：自然语��先行���结构化执��形式��后
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
  schema_version: '0.1' | '0.2' | '0.3';
  projects: Project[];
  goals: Goal[];
  preferences: Preference[];
  constraints: Constraint[];
  skills: Skill[];
  states: State[];
  decision_rules: DecisionRule[];
  meta: Meta;
}

// 返回��个空��� user model（用��初始���）
export function emptyUserModel(): UserModel {
  return {
    schema_version: '0.3',
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
