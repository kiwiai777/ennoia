# CT-0015: Observation Recap Surface v0.1

## 目标

在 `cortex observe` 现有记录列表之上增加一个轻量 recap 区块，帮助用户快速理解最近 Cortex 的使用模式。

不进入 analytics、推断或写回 user model。

## 引入的能力

### 1. buildRecap — 基于 observation 的摘要计算

纯内存函数，从 `RuntimeObservation[]` 计算出：

```typescript
interface ObservationRecap {
  total: number;          // 总记录数
  contextCount: number;   // context 事件次数
  injectCount: number;    // inject 事件次数
  allCount: number;       // 全量模式次数
  scopedCount: number;    // 聚焦模式次数
  topScope: string | undefined;  // 最高频 scope
  hasTaskHint: boolean;   // 是否曾使用 task-hint
}
```

只做计数聚合，不做趋势分析、不做推断、不参与 user model 写入。

### 2. renderRecap — 人类可读摘要输出

空日志时返回空字符串（不显示摘要块）。有记录时输出：

```
[使用摘要]

  共 N 条记录
  事件类型：context N 次 / inject N 次
  使用模式：全量 N 次 / 聚焦 N 次
  最常用 scope：<scope>          （有 scoped 记录时）
  曾使用 task-hint                （有 task_hint 记录时）
```

### 3. cmdObserve 输出结构

```
[使用摘要]
...（recap 区块）

[最近使用记录]
...（逆序记录列表，最多 20 条）
```

recap 在列表之前；原有记录列表保持不变。

## 不做的事

- 不是 analytics 面板
- 不做趋势分析
- 不做推荐或建议
- 不新增 user fact 推断
- 不参与 user model 写入
- 不做跨时间范围筛选
- 不做图表或 JSON 导出
- 不超出 CT-0015 范围进入 CT-0016

## 改动文件

- `src/core/runtime/observation.ts`：新增 `ObservationRecap`、`buildRecap()`、`renderRecap()`
- `src/index.ts`：`cmdObserve()` 新增 recap 渲染，导入 `buildRecap` / `renderRecap`
- `src/core/runtime/__tests__/observation-recap.test.ts`：新增 CT-0015 测试（24 cases）
