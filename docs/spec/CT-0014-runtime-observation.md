# CT-0014: Runtime Observation Foundation v0.1

## 目标

记录"context / inject 被使用过一次"的最小事件，建立产品可视体感基础，但不进入 extraction、推断或写入 user model。

## 引入的能力

### 1. 最小 observation 结构

每次 `cortex inject` 或 `cortex context` 成功执行后，追加一条观察记录，只含使用元信息：

```typescript
interface RuntimeObservation {
  id: string;
  timestamp: string;               // ISO8601
  event_type: 'inject' | 'context';
  agent?: string;                  // inject 路径下有效
  scope?: string;
  task_hint?: string;
  selection_strategy: 'all' | 'scoped';
  selected_entries: number;
  total_entries: number;
}
```

**刻意不含**：注入正文、user model 条目内容、任何推断结论。

### 2. 触发点

- `cortex inject ...` 成功执行后
- `cortex context ...` 成功执行后
- 失败路径（process.exit 前）不写 observation
- fail-soft：observation 写入失败时向 stderr 打印警告，不影响主命令成功路径

### 3. 存储

- 文件：`~/.cortex/observations.json`（与 `user_model.json` 完全隔离）
- 格式：`{ version: '0.1', observations: RuntimeObservation[] }`
- 最多保留 100 条（滚动截断最旧记录）
- 原子写入（临时文件 + rename）

### 4. 查看入口

```bash
cortex observe
```

输出最近 20 条使用记录，逆序（最新在前），每行一条元信息摘要：

```
[最近使用记录]

  [2026/04/19 21:30:00]  inject  agent=claude-code  模式=聚焦  scope=Cortex  条目=4/12
  [2026/04/19 21:28:00]  context  模式=全量  条目=12/12
```

## 不做的事

- 不是 runtime extraction
- 不做 candidate generation
- 不自动写回 user model
- 不做 LLM 分析 / 推断
- 不做 UI / dashboard
- 不记录注入正文或上下文正文
- 不参与 import / suggest / save 流程

## 改动文件

- `src/core/runtime/observation.ts`：新增 observation 类型、存储、append、render
- `src/index.ts`：`cmdContext()` / `cmdInject()` 成功路径追加 observation；新增 `cmdObserve()`；`usage()` 同步；`main()` 路由
- `src/core/runtime/__tests__/observation.test.ts`：新增 CT-0014 测试（19 cases）
