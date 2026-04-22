# Review Report

任务 ID：CT-0021-07
审计对象：commit `549f64032a18e1fbded2e24452cc16fba1b5db8f` on branch `task/CT-0021-07-reflect-cli`

## Summary
总体结论：revise

## Findings
### Critical
- 无

### Major
- `cortex reflect --stdin` 在真实非 TTY 管道场景下不可用，且当前行为属于 silent no-op。`cmdReflect()` 先用 `defaultReadStdinLines()` 消耗完整的 `process.stdin`（[src/index.ts](/home/kiwi/cortex/src/index.ts:654), [src/index.ts](/home/kiwi/cortex/src/index.ts:708)），随后仍调用基于同一 `process.stdin` 的 `promptSelection()`（[src/index.ts](/home/kiwi/cortex/src/index.ts:355), [src/index.ts](/home/kiwi/cortex/src/index.ts:739)）。我本地复现 `printf "我喜欢简洁代码\n" | node --import tsx ./src/index.ts reflect --stdin`，程序会打印候选和选择提示后直接以 `EXIT:0` 结束，但不会输出“未选择任何候选，已退出。”，也不会写入任何内容。这不符合审计卡 §D 的可接受条件：既没有 preflight 拒绝非 TTY，也没有明确提示用户当前路径不可交互。
- 测试掩盖了上述生产路径问题。`cli-reflect.test.ts` 通过注入 `promptFn` 和 `readStdinFn` 绕过了真实 `process.stdin` / `readline` 交互（[src/__tests__/cli-reflect.test.ts](/home/kiwi/cortex/src/__tests__/cli-reflect.test.ts:41), [src/__tests__/cli-reflect.test.ts](/home/kiwi/cortex/src/__tests__/cli-reflect.test.ts:65)），所以 `--stdin happy path` 只验证了“注入答案时能写入”，没有覆盖“非 TTY + 无注入”的真实行为（[src/__tests__/cli-reflect.test.ts](/home/kiwi/cortex/src/__tests__/cli-reflect.test.ts:132)）。当前测试集无法防止该回归继续存在。

### Minor
- `loadStore()` 只在 JSON 解析抛错时输出损坏警告；schema/version 不匹配时会静默返回空 store（[src/core/suggest-loop/store.ts](/home/kiwi/cortex/src/core/suggest-loop/store.ts:39), [src/core/suggest-loop/store.ts](/home/kiwi/cortex/src/core/suggest-loop/store.ts:54)）。这意味着未来出现 `version !== '0.1'` 时，用户会看到“空数据”而不是明确的兼容性提示；对应测试也固化了这一行为（[src/core/suggest-loop/__tests__/store.test.ts](/home/kiwi/cortex/src/core/suggest-loop/__tests__/store.test.ts:93)）。
- exec 卡要求“用户选择后走 `confirmSuggestion`”，但 `cmdReflect()` 直接把 `SuggestionItem` 映射为 `appendEntry()` 输入并写盘，绕过了现有纯函数入口（[src/index.ts](/home/kiwi/cortex/src/index.ts:746), [src/core/suggest-loop/confirmSuggestion.ts](/home/kiwi/cortex/src/core/suggest-loop/confirmSuggestion.ts:22)）。这没有改变当前结果，但确实偏离了既定复用边界并复制了一份映射逻辑。

## Spec Compliance
- DL-0020 边界基本符合：store 仍独立落在 `~/.cortex/suggest-loop-store.json`，没有写入主 `user_model.json`，也未引入 dedupe / merge / rewrite / delete、LLM 扩展、observe 面板改动或 schema 扩展。
- `cmdReflect` 的基础 CLI 契约大体符合：未知参数、空输入、`--stdin` 与位置参数互斥、无候选、`--list` 空 store、usage 更新都已实现。
- 持久化层满足“同目录 tmp + rename”与 fail-soft 基线，但读取侧对 version/schema 不匹配缺少显式告警。
- 与 exec 卡相比，当前实现最主要的不符合点是 `--stdin` 生产交互路径不可用，以及选择确认未复用 `confirmSuggestion`。

## Risks
- 真实生产环境下，`cat x.log | cortex reflect --stdin` 若产生候选，当前表现为：打印候选和选择提示后直接结束，退出码为 0，不写入任何记录，也不给出“未选择”或“当前非交互不可继续”的明确提示。它不是 hang，但属于 silent no-op，用户很容易误以为命令仍在等待输入或已经完成了某种默认选择。
- 当前代码没有任何 preflight 检查；例如没有在 `useStdin` 且后续还需要交互选择时检查 `process.stdin.isTTY`，也没有提供 `--accept-all` 之类的非交互退路。
- 由于测试通过注入完全绕过了真实 stdin，后续即使再次改坏这一生产路径，现有测试仍可能全部通过。

## Required Fixes
- 在 `--stdin` 路径增加明确的非交互处理。最小可接受修复有两种：
  1. preflight：若 `--stdin` 且需要后续交互，但 `process.stdin.isTTY !== true`，则 fail-fast `exit 1` 并给出明确错误消息；
  2. 或显式定义一个非交互策略，例如支持 `--accept-all`，避免再次读取已消费的 stdin。
- 增加一个不注入 `promptFn` 的真实行为测试，覆盖“非 TTY + `--stdin` + 有候选”场景，并断言预期输出与退出码，防止 silent no-op 回归。
- 选择确认路径改为经由 `confirmSuggestion` 或等价共享入口生成 `UserModelEntry`，避免 CLI 层复制该映射逻辑。

## Merge Recommendation
- approve with changes
