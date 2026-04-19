# CT-0018: Observation-Derived Candidate Surface v0.1

## 目标

基于已有的 usage observation 数据，在 `cortex observe` 中新增一层纯观察性的 candidate surface。其主要职责是提示“哪些使用模式已经反复出现，值得作为后续被看见或核查的候选”。

不自动写回 user model，不形成 recommendation engine，不触发自动执行行为。

## 定位约束

1. **Human-facing + non-committal**
   - 展现形式：“已观察到某类模式重复出现，可作为后续核查候选”。
   - 显式澄清：文案必须带有“以下内容仅表示运行时使用模式，不代表已写入 user model”。
   
2. **纯事实依赖**
   - 候选项只基于已有的事实或其衍生结果，如 `recap`（包括 scope、event_type、selection_strategy）。
   - 不调用大模型分析，不做 ranking 或 scoring。
   
3. **隔离 Action**
   - Candidate 不直接转化成任务、action，也不提供接管或注入功能。

## Candidate 类型定义

| kind | 触发条件 | 示例 message |
| --- | --- | --- |
| `repeated_scope_candidate` | total ≥ 5 且 recap.topScope 存在且出现 > 1 次 | 已观察到 scope 'X' 重复出现，可作为后续核查候选 |
| `focused_usage_candidate` | total ≥ 5 且 scoped/total ≥ 0.4 | 已观察到聚焦使用 (scoped) 占比较高，可作为后续核查候选 |
| `inject_primary_usage_candidate` | total ≥ 5 且 inject/total ≥ 0.6 | 已观察到以 inject 为主的使用模式，可作为后续核查候选 |

## 输出层次

在 `cortex observe` 的展示顺序如下：
1. **[观察发现的稳定模式（供核查候选）]** （本阶段新增的 Candidate Surface，层级最高）
2. **[触发提示]** (Trigger hints)
3. **[使用健康信号]** (Health signals)
4. **[使用摘要]** (Recap)
5. **[最近使用记录]** (Raw observation records)

## 不做的事

- 不做 suggestion 写入链路的连通
- 不写入/改变 user model 状态
- 不做 runtime hook 或 auto-injection
- 不扩张为 scoring dashboard 
