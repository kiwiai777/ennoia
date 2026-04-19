# CT-0019: Observation Injection Experiment v0.1

## 目标

在已经构建的 observation（CT-0014 ~ CT-0018）体系之上，试探性地把统计数据带给真正的 agent：给 `cortex inject` 提供了一个 **最小、可控、默认关闭** 的 agent-facing 注入层。

## 原型设计哲学

CT-0019 故意选择了“最轻量级”的方式接触 Agent。不选择扩充 `InjectionPack` schema、不选择 json 格式的扩展、也不选择自动附着。
而是仅仅为 **render 层（text path / claude-code projector）** 提供一个 `--with-observation` 开关。

### 为什么只用 recap，不进 pack schema？
因为“观察到的使用模式”是否对 agent 真正有价值仍是未知数。如果直接放入 `InjectionPack` schema，即构成了长期的接口契约。将实验局限在 render 层，使得其进退自如，如果后续发现数据能够确实左右大模型推断或规划，再去扩展 JSON 契约不迟。这也解释了目前仅包含基础计数，而放弃了含有主观解读的 Hints 与 Candidates 的原因（它们可能更具“蛊惑性”导致 agent 胡乱行动）。

### 为什么默认关闭？
注入冗长的、没有明确对应当前 task 意图的元统计数据，可能产生 Context Noise。为避免破坏 `generic` 与 `claude-code` 过去形成的优质运行结果，必须需要 explicit opt-in。

### 为什么不是 Preference Inference / Write Path？
Cortex 目前只在 CLI 的 human-facing output 提供 Candidates。Agent 不应该直接利用这些 observation 代替用户修改 `User Model`（否则会导致伪自动化，越俎代庖）。通过严格收缩渲染的字段边界，使其看起来“只是一本帐”。

## CLI 新增

```
cortex inject [--agent <id>] [--format text|json] [--scope <scope>] [--task-hint "<hint>"] [--with-observation]
```

- `--with-observation`：如果给定此 flag，会在生成的指令（文本结构下）前方，补充由 `buildRecap()` 获取的 `[运行时使用摘要（仅供参考）]` Block。对 `--format json` 无效（保留现有 json 纯净契约）。

## 内容渲染

如果日志非空并携带 `--with-observation`，会在 Agent 指令前方插入如下文本（例）：
```
[运行时使用摘要（仅供参考）]
- 总记录数：10
- 事件分布：context: 4 / inject: 6
- 模式分布：all: 2 / scoped: 8
- 是否包含 task-hint：是
- 常见 scope：Cortex
```

所有的描述词被限制在了“统计/现状展示”上。不再包含 `建议`、`偏好`、`可以尝试`等推荐用语。
