# Cortex 与 RAG 的关系（精简公开版）

## 一句话结论

RAG 更擅长从大量原始材料中“找回相关内容”；  
Cortex 更擅长把这些材料转化为“可持续影响 agent 行为的用户模型”。

两者不是同一层，也不应互相替代。

## RAG 擅长什么

RAG 更适合：

- 从大规模原始语料中检索相关片段
- 找回“之前提到过什么”
- 在长文档、日志、聊天记录中做召回
- 为回答问题补充相关上下文

如果输入是大量原始文本，RAG 在“找”这一步通常更高效。

## Cortex 擅长什么

Cortex 更适合：

- 从原始材料中提炼用户相关结构
- 形成 goal / project / preference / constraint / decision rule
- 保留 provenance，并在必要时走用户确认
- 把结果沉淀成 user model
- 再把 user model 生成可供 agent 消费的 injection

Cortex 的重点不是“找原文”，而是：

**形成稳定、可控、可审计、可影响行为的用户理解层。**

## 两者的层级关系

更合适的理解是：

- **RAG = 原始记忆 / 检索层**
- **Cortex = 用户理解 / 行为调控层**

也就是说，RAG 更接近底层输入能力；  
Cortex 更接近上层的用户模型编译与行为影响能力。

## Cortex 不应变成什么

Cortex 不应变成：

- 又一个 memory store
- 又一个 vector DB 包装层
- 又一个聊天记录检索器

否则就会偏离“User Model Layer”的核心定位。

## 未来如何协同

未来 Cortex 完全可以与 memory / RAG 系统协同：

- memory / RAG 负责保存和检索原始材料
- Cortex 负责抽取、结构化、去重、确认与写入 user model
- adapter 可以把外部 memory 系统作为 Cortex 的输入源

也就是说：

**Memory 工具负责存和找，Cortex 负责理解和编译。**

## 当前阶段的产品判断

当前 Cortex 的重点仍然是：

- user model
- injection
- cross-agent consistency
- adapter / runtime integration foundation

而不是去和通用 RAG 系统竞争检索效率。
