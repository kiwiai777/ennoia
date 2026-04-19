# CT-0020: Observe Surface Consolidation

## 目标

重构 `cortex observe` 面板，收敛重复表面，减少信息噪音。
合并 CT-0017 (Trigger Hints) / CT-0018 (Observation-Derived Candidate Surface) 以及之前计划中（已废弃）的 CT-0020 (Injection Trigger) 中围绕 `inject` 使用率、`focused` 模式及 `task-hint` 等相近事实的重复表达。
让面板更薄，语义更清晰，同时保持观察导向、人类可读、非建议式的产品边界。

## 为什么收敛？

之前设计引入了多层：
- Trigger Hints (指示可能值得重新查看)
- Candidates (指示稳定使用模式供核查)
- Injection Trigger (指示具体的动作阈值)

这些层由于只从同一个 recap (上下文与注入统计、聚焦模式出现次数) 推导结果，导致针对相同的事实（如 "inject 使用较高" 或 "出现 scoped 使用"）在多处以不同的文案反复呈现，产生了大量的冗余，不但没有提供额外价值反而使面板混乱。

## 最终保留的层级结构

重构后，`cortex observe` 仅仅保留以下四个独立层次（按渲染顺序）：

1. **[触发提示]** (Trigger hints) 
   接管原 candidate 和 trigger 的所有核心表达，成为指示观察模式的主力面板（最顶层）。
2. **[使用健康信号]** (Health signals)
   指出目前使用情况可能过少或单一（如全量模式为主、无足够的事件数量）。
3. **[使用摘要]** (Recap)
   保留的纯原始数据统计。
4. **[最近使用记录]** (Raw observation records)
   保留的最近N条事件原始列表。

被**删除/并入**的内容：
- 删除了 `Observation-Derived Candidate Surface` (CT-0018)，以消除概念重复。
- 放弃了原本新增 `Injection Trigger Foundation` 的做法，将其意图并入 Trigger hints 中。

## 产品边界与底线 (Not To Do)

本阶段**不包含**：
- 不做 recommendation / action layer（没有“建议、应该、可尝试、自动执行、查看 context”等用词）。
- 不做 auto-trigger 或自动调用 `cortex inject`。
- 不做任何写回（Write-back），即不影响 user model。
- 不改变 schema，不改变现有的 observation 写入和读取机制，只改呈现层（Rendering / Consolidation）。
