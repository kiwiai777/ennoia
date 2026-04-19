# CT-0016: Usage Health Signals v0.1

## 目标

基于已有 observation 数据，为 `cortex observe` 增加少量、克制、可解释的 usage health signals，帮助用户理解自己是否已经形成有效的 Cortex 使用模式。

不做 recommendation、scoring、推断，不触发自动行为，不写回 user model。

## 引入的能力

### 1. 五种 rule-based signals

每个 signal 都基于已有 observation 字段做简单规则判断，可直接解释来源：

| kind | 触发条件 | 示例 message |
|---|---|---|
| `low_sample` | total < 5 | 当前样本较少（共 N 条），暂不足以看出使用模式 |
| `mostly_all_mode` | total >= 5 且 allCount/total >= 0.8 | 最近使用以全量模式为主（全量 N / 共 N） |
| `scoped_emerging` | total >= 5 且 scopedCount >= 1 | 已观察到聚焦使用（scoped 出现 N 次） |
| `task_hint_used` | total >= 5 且 hasTaskHint | 已出现 task-hint 使用 |
| `single_event_type` | total >= 5 且 contextCount=0 或 injectCount=0 | 当前使用仅包含单一事件类型（context/inject） |

**样本不足时（low_sample）提前返回**，不输出其他 signal，避免对极少样本过度解读。

### 2. 阈值常量（导出）

```typescript
export const HEALTH_LOW_SAMPLE_THRESHOLD = 5;   // 样本不足判断基线
export const HEALTH_MOSTLY_ALL_RATIO = 0.8;      // 全量为主判断比例
```

### 3. cmdObserve 三层输出结构

```
[使用健康信号]          ← CT-0016（新增，最顶层）
  · signal1
  · signal2

[使用摘要]              ← CT-0015
  共 N 条记录
  ...

[最近使用记录]          ← CT-0014
  [2026/04/19 ...] ...
```

空日志时：不显示 health signals 区块（与 recap、records 行为一致）。

## 不做的事

- 不输出分数或排名
- 不做"建议你去做 X"的 recommendation
- 不输出任何 user fact inference
- 不新增 observation schema
- 不写回 user model
- 不触发 runtime injection
- 不引入模型调用
- 不是 analytics / dashboard

## 改动文件

- `src/core/runtime/observation.ts`：新增 `HealthSignalKind`、`HealthSignal`、`HEALTH_LOW_SAMPLE_THRESHOLD`、`HEALTH_MOSTLY_ALL_RATIO`、`buildHealthSignals()`、`renderHealthSignals()`
- `src/index.ts`：`cmdObserve()` 在 recap 上方渲染 health signals；导入新函数
- `src/core/runtime/__tests__/observation-health.test.ts`：新增 CT-0016 测试（28 cases）
