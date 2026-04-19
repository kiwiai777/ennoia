# Cortex 产品边界（精简公开版）

## 一句话定位

Cortex 是 **User Model Layer**。  
它的职责不是替代 AI assistant，也不是做通用 memory/RAG 工具，而是把关于“用户是谁、在做什么、偏好什么、如何决策”的信息沉淀成可持续、可注入、可影响 agent 行为的用户模型。

## 我们是什么

Cortex 当前聚焦三件事：

1. **User Model**
   - 用户身份与长期特征
   - goal / project / preference / constraint / decision rule 等结构化信息

2. **Injection**
   - 将用户模型生成可供 agent 消费的注入内容
   - 逐步影响 prompt、planning、tool selection 与行为方式

3. **Persistence**
   - 用户模型持续存在
   - 不依赖单次对话
   - 可跨 agent 复用

## 我们不是什么

Cortex 不是：

- 聊天产品
- AI 写作工具
- AI coding 工具
- 通用 agent framework
- multi-agent orchestration 系统
- workflow engine
- automation platform
- 纯 memory 工具
- 纯 RAG 系统
- 重 UI / dashboard 优先产品

## 当前产品边界

当前阶段，Cortex 采用克制路线：

- 优先做本地 CLI / adapter / injection
- 不做大而全 SDK-first 平台
- 不做伪自动化
- 不做不可控自动写入
- 不把“保存一切”当成目标
- 不把“检索一切”当成目标

## 功能判断标准

一个功能是否值得做，至少要回答：

1. 是否增强 user model？
2. 是否增强用户在 AI 系统中的持续存在？
3. 是否真实影响 agent 行为？

如果都不能明显增强，优先级应降低。

## 当前阶段的关键约束

- 用户确认后才写入 user model
- LLM 是可选增强，不是前提依赖
- 先建立 user model，再逐步影响 agent
- 先建立可消费的 injection，再逐步进入真实 runtime integration
- 自动化、智能化、控制力增强都应晚于基础 user model 成熟度

## 对协作者的提示

在 Cortex 仓库中实现功能时，应优先保持以下方向：

- 让用户模型更稳定、更清晰、更可复用
- 让 injection 更可消费、更接近真实集成
- 保持架构克制，不引入与当前阶段不匹配的复杂平台能力
