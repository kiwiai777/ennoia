# CT-0012 — Selection-Aware Injection Rendering v0.1

## 概述

CT-0012 让 CT-0011 的 selection 结果在 text / projector 输出层被更清晰地表达，
使 agent 能看到最小必要的 selection context，而不只是"被过滤后的内容列表"。

## 新增渲染能力

### 1. Selection framing 行

当 `selection_strategy === 'scoped'` 时（即使用了 `--scope` 或 `--task-hint`），
text / projector 输出在正文内容前增加一行简短的 framing：

```
[注入范围：聚焦 → Cortex]
[注入范围：任务线索 → injection planning]
[注入范围：聚焦 → Cortex | 任务线索 → injection]
```

`all` 模式下不输出此行（保持原有简洁）。

### 2. open_questions 进入 text / projector

当 selection 存在歧义或信息不足时（scope 未命中、多候选、hint 无匹配），
`open_questions` 以克制方式出现在正文末尾：

```
⚠️ 待确认问题（以下情况尚不明确，仅供参考，不阻断执行）：
  - scope "Cortex" 匹配到多个项目：Cortex Alpha、Cortex Beta
```

open_questions 为空时不输出任何相关标头。

## agent-facing vs 输出层信息划分

### CLI `--format json`（InjectionPack）包含的字段

| 字段 | agent text / projector | InjectionPack（CLI JSON 输出） |
|------|----------------------|-------------------------------|
| 当前聚焦 scope / task-hint | ✅ framing 行 | ✅ `source.scope` / `source.task_hint` |
| open_questions | ✅ ⚠️ bullet list | ✅ `open_questions[]` |
| selection_strategy | ❌（由 framing 暗示） | ✅ `source.selection_strategy` |
| 条目总数 / 各 kind 数量 | ❌ | ✅ `user_summary.total_entries` / `user_summary.counts` |
| 条目内容 | ✅ 渲染后正文 | ✅ `entries[]` 及各 kind bucket |

### 仅存在于内部运行态，不属于 CLI JSON 输出契约

以下字段属于 `RuntimeContextMeta`（`selectRuntimeContext` 的内部返回值），
**不会**出现在 `cortex inject --format json` 的 InjectionPack 输出中：

- `matched_project_ids` — scope 命中的项目 id 列表
- `total_model_entries` — selection 前原始 user model 条目总数
- `selected_entries` — selection 后的条目数

这些字段用于内部调试和 selection 层的 open_questions 生成，不对外暴露为 JSON pack 契约。

**原则**：不把内部 metadata 原样 dump 给 agent。只把"对 agent 有行为指导意义"的信息放入 text 层或 InjectionPack 顶层结构。

## 两条路径保持独立模板

- **generic text path**（`createInjectionPackage`）：以 `--- Cortex 长期用户模型 ---` 起头，framing 行在标头下方，结构扁平。
- **Claude Code projector path**（`projectPackForClaudeCode`）：以 `<cortex-user-model-injection>` XML 包装，framing 行在引导语下方，段落结构更清晰。

两条路径共享同一 CT-0011 selection 结果，但渲染格式各自独立。

## 不做的事（CT-0012 明确不包含）

- runtime extraction
- model-assisted selection
- projected JSON format（JSON pack 结构不变）
- 多 agent projection framework
- embeddings / ranking
- 自动写回 user model
- planner / tool-selection 系统

## 当前版本说明

CT-0012 是纯渲染层改动，不修改 selection 逻辑（CT-0011）和 pack 结构（CT-0009）。
JSON pack 仍是结构化元数据的主出口；text / projector 只做最小必要的 agent-facing 表达。
