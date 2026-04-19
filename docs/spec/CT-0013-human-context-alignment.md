# CT-0013: Human-Facing Context Alignment v0.1

## 目标

让 `cortex context` 的 human-facing 输出体现 CT-0011/CT-0012 的 selection 结果，帮助 owner / user 看清"当前 Cortex 准备如何向 agent 呈现我"。

## 引入的能力

### 1. Selection summary（scoped 模式）

当 `cortex context` 使用 `--scope` 或 `--task-hint` 时，输出顶部会新增 `[当前上下文范围]` 块：

```
[当前上下文范围]
  模式：聚焦（非全量）
  聚焦项目：Cortex
  任务线索：injection
  已选条目：4 / 12
```

all 模式下（无 scope / task-hint）此块不输出，保持原有干净格式。

### 2. open_questions 的 human-facing 呈现

当 selection 发现歧义（scope 未命中 / 多候选 / hint 无匹配），输出末尾会出现 `[待确认信息]` 块：

```
[待确认信息]
  以下情况当前尚不明确，供参考，不影响执行：
  - scope "xyz" 未匹配到任何已知项目，已返回全部项目供参考
```

措辞克制，表达"尚不明确"而非系统错误。不使用 agent-facing 的 ⚠️ 警告格式。

### 3. cortex context 支持 --scope / --task-hint

```bash
cortex context                          # all 模式，全量输出
cortex context --scope Cortex           # scoped，聚焦 Cortex 项目
cortex context --task-hint "injection"  # scoped，按任务线索过滤
cortex context --scope Cortex --task-hint "injection"
```

## 不做的事

- 不是 runtime extraction
- 不是 observation logging
- 不是 explainability 平台
- 不引入新的 JSON 格式
- 不新建第二套 selection 逻辑（共享 CT-0011 的 `selectRuntimeContext`）

## 语义一致性保证

- human-facing selection summary 直接来自 `RuntimeContext.meta`（CT-0011 输出）
- `open_questions` 来自 `RuntimeContext.open_questions`（CT-0011 输出）
- 与 agent-facing 输出共享同一 selection 结果，语义不漂移

## 改动文件

- `src/core/runtime/context.ts`：`renderContextForHuman()` 新增 selection summary + open_questions 块
- `src/index.ts`：`cmdContext()` 支持 `--scope` / `--task-hint` 参数
- `src/core/runtime/__tests__/human-context.test.ts`：新增 CT-0013 测试（21 cases）
