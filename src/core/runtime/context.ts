// Runtime Context Builder
// 把 user model 转成一段可直接拼进 prompt 的中文文本。
// 本阶段不做排序、裁剪、token 预算 —— 先让它能用。

import type {
  UserModel,
  BaseItem,
  DecisionRule,
} from '../user-model/types.js';

function formatItems(items: BaseItem[]): string {
  if (items.length === 0) return '  （暂无）';
  return items
    .map((item) => {
      const desc = item.description ? `：${item.description}` : '';
      return `  - ${item.label}${desc}`;
    })
    .join('\n');
}

function formatDecisionRules(rules: DecisionRule[]): string {
  if (rules.length === 0) return '  （暂无）';
  return rules
    .map((rule) => {
      if (rule.when && rule.then) {
        return `  - ${rule.label}（当 ${rule.when} → ${rule.then}）`;
      }
      return `  - ${rule.label}`;
    })
    .join('\n');
}

// 生成一段中文格式的 user context
export function buildContext(model: UserModel): string {
  const sections: string[] = [];

  sections.push('[User Context]');
  sections.push('');
  sections.push('项目：');
  sections.push(formatItems(model.projects));
  sections.push('');
  sections.push('目标：');
  sections.push(formatItems(model.goals));
  sections.push('');
  sections.push('偏好：');
  sections.push(formatItems(model.preferences));
  sections.push('');
  sections.push('约束：');
  sections.push(formatItems(model.constraints));
  sections.push('');
  sections.push('决策规则：');
  sections.push(formatDecisionRules(model.decision_rules));

  return sections.join('\n');
}
