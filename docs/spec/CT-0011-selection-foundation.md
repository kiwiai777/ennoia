# CT-0011 — Scoped / Task-Aware Selection Foundation v0.1

## 概述

CT-0011 为 Cortex injection 引入了显式 scope / task-hint 驱动的可解释选择层。

在此之前，`cortex inject` 固定选取用户模型全量数据（strategy = `all`）。
CT-0011 起，可通过 `--scope` 和 `--task-hint` 参数控制注入内容的范围。

## 核心设计

### 选择层（Selection Layer）

位于 `src/core/runtime/context.ts`，`selectRuntimeContext(model, options)`。

- **无 scope / task-hint**：strategy = `all`，行为与 CT-0009 一致（全量选择）。
- **有 scope 或 task-hint**：strategy = `scoped`，触发可解释规则过滤。

### Scoped 选择规则

**scope 匹配（项目过滤）**：
- 在 `projects` 中按 label / id 做大小写不敏感的子串匹配。
- 命中项目 → 只选取该项目及与之关联的 goals / skills / states（item.scope === matched project id）。
- 同时保留 scope = 'global' 的条目作为全局背景。
- 未命中任何项目 → 写入 open_questions，返回全量项目作兜底。
- 命中多个项目 → 写入 open_questions 说明多候选。

**task-hint 匹配（关键词过滤）**：
- 将 task-hint 按空格 / 中文分隔符拆成关键词（≥2 字符）。
- 对 goals / skills / states 做 label + description 的子串匹配。
- 有 scope 命中时：hint 命中的条目额外纳入（scope OR hint）。
- 仅 hint 无 scope 时：**只选 hint 命中的条目**，不全量保留（真实过滤）。
- 无关键词命中 → 写入 open_questions 说明信息不足。

**全局上下文（永远包含）**：
- `preferences` / `constraints` / `decision_rules` 全量保留，不受 scope / task-hint 过滤。

### open_questions

不再永远为空。会在以下情况写入：
- scope 未匹配到任何已知项目
- scope 匹配到多个候选项目
- task-hint 未能匹配到任何具体条目

### selection_metadata

`RuntimeContextMeta` 新增：
- `scope?: string` — 传入的 scope 值
- `task_hint?: string` — 传入的 task-hint 值
- `matched_project_ids?: string[]` — scope 命中的项目 id 列表
- `total_model_entries: number` — 原始 user model 条目总数
- `selected_entries: number` — 选择后的条目数

`InjectionPackSource` 新增：
- `scope?: string`
- `task_hint?: string`

## CLI 使用

```bash
cortex inject --scope <scope>
cortex inject --task-hint "<hint>"
cortex inject --scope <scope> --task-hint "<hint>"

# 可与 --format / --agent 组合
cortex inject --format json --scope Cortex
cortex inject --agent claude-code --scope Cortex --task-hint "injection planning"
```

## 三条路径共享 selection 结果

text / json / Claude Code projector 三条输出路径均经由 `buildInjectionPack` → `selectRuntimeContext`，共享同一选择结果，不各自做独立过滤。

## 不做的事（CT-0011 明确不包含）

- runtime extraction / observation hooks
- model-assisted selection（无 LLM 参与）
- embedding / ranking 系统
- heuristic extraction 产品化
- 自动 candidate generation
- multi-agent selection policy

## 当前版本说明

CT-0011 是 **可解释规则版本**，不依赖模型。
这不是 runtime extraction，也不是自动 runtime hook，
而是一个明确的、由用户显式传入 scope/hint 驱动的静态选择层。
