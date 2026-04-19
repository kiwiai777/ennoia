# CT-0017: Runtime Trigger Hints Foundation v0.1

## 目标

基于已有 observation / recap / health signals，为 `cortex observe` 增加一层非常克制的 human-facing trigger hints，提示已观察到的 runtime 使用特征。

不自动执行任何动作，不写回 user model，不接 runtime hook，不是 action hint 或 recommendation layer。

## 引入的能力

### 1. 三种 rule-based trigger hints

| kind | 触发条件 | 示例 message |
|---|---|---|
| `focused_pattern_observed` | total ≥ 5 且 scopedCount ≥ 1 或 hasTaskHint | 已观察到 scoped 或 task-hint 使用，聚焦使用模式已出现 |
| `focused_mode_shifting` | total ≥ 5 且 scoped/total ≥ 0.3 | 已观察到聚焦使用信号，当前记录中聚焦使用占比较高 |
| `inject_pattern_observed` | total ≥ 5 且 inject/total ≥ 0.5 | 已观察到 inject 使用信号，当前记录中 inject 使用占比较高 |

- 样本不足（total < 5）时不输出任何 hint
- 每条 hint 文案仅做观察性事实描述，不包含行动指导

### 2. 阈值常量（导出）

```typescript
export const HINT_SCOPED_RATIO_THRESHOLD = 0.3;   // scoped 占比阈值
export const HINT_INJECT_RATIO_THRESHOLD = 0.5;   // inject 占比阈值
```

### 3. cmdObserve 四层输出结构

```
[触发提示]              ← CT-0017（最顶层，新增）
  · hint1
  · hint2

[使用健康信号]          ← CT-0016

[使用摘要]              ← CT-0015

[最近使用记录]          ← CT-0014
```

空日志 / 样本不足时不显示 trigger hints 区块。

## 不做的事

- 不自动执行 inject / context
- 不自动改 runtime 状态
- 不写回 user model
- 不是 recommendation engine
- 不做 scoring
- 不引入模型调用
- 不做时间窗口对比
- 不新增 observation schema 或存储

## 改动文件

- `src/core/runtime/observation.ts`：新增 `TriggerHintKind`、`TriggerHint`、阈值常量、`buildTriggerHints()`、`renderTriggerHints()`
- `src/index.ts`：`cmdObserve()` 在 health signals 上方渲染 trigger hints；导入新函数
- `src/core/runtime/__tests__/observation-trigger-hints.test.ts`：新增 CT-0017 测试（26 cases）
