import { ObservationRecap } from './observation.js';

// CT-0019: Observation Recap 最小化代理注入面
// 仅生成纯数据摘要文字，绝不包含推荐和倾向。
// 用于 `cortex inject --with-observation`

export function renderAgentFacingObservationRecap(recap: ObservationRecap): string | null {
  if (recap.total === 0) return null;

  const lines: string[] = ['[运行时使用摘要（仅供参考）]'];
  lines.push(`- 总记录数：${recap.total}`);

  const typeParts: string[] = [];
  if (recap.contextCount > 0) typeParts.push(`context: ${recap.contextCount}`);
  if (recap.injectCount > 0) typeParts.push(`inject: ${recap.injectCount}`);
  if (typeParts.length > 0) lines.push(`- 事件分布：${typeParts.join(' / ')}`);

  const modeParts: string[] = [];
  if (recap.allCount > 0) modeParts.push(`all: ${recap.allCount}`);
  if (recap.scopedCount > 0) modeParts.push(`scoped: ${recap.scopedCount}`);
  if (modeParts.length > 0) lines.push(`- 模式分布：${modeParts.join(' / ')}`);

  lines.push(`- 是否包含 task-hint：${recap.hasTaskHint ? '是' : '否'}`);

  if (recap.topScope) {
    lines.push(`- 常见 scope：${recap.topScope}`);
  }

  return lines.join('\n');
}
