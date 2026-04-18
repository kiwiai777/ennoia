import type { ISO8601 } from '../user-model/types.js';
import type { SelectionStrategy, UserSnapshot } from './context.js';

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

import { selectRuntimeContext, renderPromptContext } from './context.js';
import type { UserModel } from '../user-model/types.js';

export function createInjectionPackage(
  model: UserModel,
  agentId: string = 'generic',
  locale: string = 'zh'
): InjectionPackage {
  // 1. selection layer
  const ctx = selectRuntimeContext(model, { agent: agentId });
  
  // 2. rendering layer
  const snapshotText = renderPromptContext(ctx);
  
  let instruction_text = '';
  
  // 3. Agent-aware wrapping
  // TODO: 后续多语言支持
  if (agentId === 'claude-code') {
    instruction_text = `【Cortex 注入层：系统级用户模型上下文】

你正在服务当前终端和项目的用户。以下是由 Cortex 提供的长期用户上下文。
在你的规划和工具使用过程中，请优先遵循以下约束和偏好；当遇到信息不一致时，以本清单为指导方针。

${snapshotText}

(以上内容由 Cortex 注入，代表了跨环境的持续用户状态。请在理解当前项目的同时，参照此模型行事。)`;
  } else {
    // Generic
    instruction_text = `[Cortex Injection: User Model Context]

你正在服务的用户拥有以下长期跨环境的状态、偏好与目标。
请在回答或执行任务时，综合考虑这些信息：

${snapshotText}`;
  }

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
