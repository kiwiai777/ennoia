# Stage 17 E2E Demo — Cortex × OpenClaw

Date: 2026-04-25

## 验证命题

在 Claude Code workspace 里积累的用户偏好，
经 Cortex 提取和注入后，OpenClaw 的 agent 也能知道。

## 执行流程

### 1. Cortex inject 输出
```
> cortex inject --target openclaw

🚀 Cortex → OpenClaw [实际写入]
--------------------------------------------------
🔍 解析目标工作区...
   配置读取: ~/.openclaw/openclaw.json
   注入路径: /home/kiwi/.openclaw/workspace/USER.md

📦 读取 Cortex User Model...
   来源: /home/kiwi/cortex/.cortex/user_model.json
   项数: 2

📝 准备注入内容...
--- 注入内容预览 ---
The user's goal is to learn how to write highly concurrent code.
The user prefers claude code for coding and hermes agent for work.
--------------------

⚙️  执行文件写入...
   模式: Append (未找到 <!-- CORTEX_USER_MODEL_BEGIN --> 标记)
   文件: /home/kiwi/.openclaw/workspace/USER.md

✓ 写入完成。

⚠️ 请执行以下命令重启 OpenClaw gateway 以使新配置生效：
   systemctl --user restart openclaw-gateway
--------------------------------------------------
```

### 2. USER.md 注入后状态
```
I am a software engineer.
I write mostly TypeScript and Rust.

<!-- CORTEX_USER_MODEL_BEGIN -->
The user's goal is to learn how to write highly concurrent code.
The user prefers claude code for coding and hermes agent for work.
<!-- CORTEX_USER_MODEL_END -->
```

### 3. OpenClaw agent 验证

**问题 1（无关问题）**：Help me plan my weekend
**Agent 回答**：
I asked you for details earlier to give you a good plan, but you didn't answer. I'll make this quick:

**Quick answers I need:**

1. **Your programming level:** Beginner / Intermediate / Advanced?
2. **Time available:** Saturday only? Both days? How many hours total?
3. **Goal:** Learn something new OR build something useful?
4. **Type of project:** Web, mobile, CLI, API, ML/AI, games, or don't care?

**Or say "surprise me"** and I'll pick:
- Personal Dashboard (web project)
- Intermediate level
- About 8-12 hours total
- Build something useful

Your call — give me answers or I'll go with "surprise me" and give you the detailed schedule.

**问题 2（工具偏好）**：Which AI coding tools do you recommend for me?
**Agent 回答**：
Based on what I know about you, here are the best AI coding tools:

**You already use:**
- **Claude Code** — Great for everyday coding (you like this one)
- **Hermes Agent** — You prefer this for work

**Other solid options:**

**For web/full-stack:**
- **Cursor** — AI-first VS Code fork, great autocomplete and inline edits
- **Replit AI** — Good for quick prototypes and learning
- **GitHub Copilot** — Reliable autocomplete, integrates everywhere

**For specific workflows:**
- **Windsurf** — Multi-file editing, good for refactoring
- **v0 by Vercel** — UI/prototyping focused
- **Bolt.new** — AI-powered scaffolding, good for starting projects

**My recommendation for you:**
- Keep using **Claude Code** for your main coding (you already like it)
- Keep **Hermes Agent** for work tasks
- Try **Cursor** if you want something different for web projects

**Quick question:** Are you happy with Claude Code and Hermes, or looking for something to replace one of them?

## 结论

- [x] 核心命题验证成功：OpenClaw 知道用户偏好 claude code 和 hermes agent
- [x] 部分成功：直接询问时知道，无关问题未主动提及（符合 FU3 实测的 LLM 自然行为）
- [ ] 未成功：原因分析

## 已知限制

- user_model.json 中仍有部分开发期历史数据（CT-0005/CT-0006 fixture）
- suggest-loop store 与主 user_model 尚未合并（Stage 19 候选）
- 注入后需手动 restart openclaw-gateway
