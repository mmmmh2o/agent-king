# Agent-king 👑

全自动化 AI 开发调度平台 — 一句话启动，多 Agent 并行开发。

## 快速开始

```bash
# 安装
npm install && npm run build

# 一句话启动
node dist/index.js run "做一个能自动记账的 Telegram bot"

# 打开 Web 面板
open http://localhost:3456
```

## 命令

| 命令 | 说明 |
|------|------|
| `run "想法"` | 一句话启动全自动开发 |
| `split "想法"` | 只拆分任务，不执行 |
| `serve` | 仅启动 Web 监控面板 |
| `status` | 查看当前任务状态 |
| `stop` | 停止所有 Worker |

## 选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--workers N` | 3 | Worker 数量 |
| `--dir path` | . | 项目目录 |
| `--model name` | claude | AI 模型 |
| `--port N` | 3456 | Web 面板端口 |

## 架构

```
你的想法 → Task Splitter (LLM) → tasks.json
                                      ↓
         Scheduler (5s 循环) ← 读取 tasks.json
              ↓
         分配给空闲 Worker (tmux session)
              ↓
         Monitor (30s 轮询) → 异常检测 → 告警
              ↓
         Hooks Receiver → events.jsonl → WebSocket → Dashboard
```

## 环境变量

```bash
export OPENAI_API_KEY=sk-xxx           # 用于任务拆分
export OPENAI_BASE_URL=https://...     # 可选，自定义 API 端点
export LLM_MODEL=gpt-4o-mini           # 可选，默认模型
export WORKER_MODEL=claude             # Worker 使用的 AI 引擎
export AGENT_KING_PORT=3456            # Web 面板端口
```

## Web 面板

启动后访问 `http://localhost:3456`：
- 📊 总体进度（完成/进行中/待执行/失败）
- 🤖 Worker 状态（空闲/忙碌/错误）
- 📋 任务列表（实时更新）
- 📡 实时事件流
- 🔴 异常告警横幅

## 依赖

- Node.js >= 20
- tmux >= 3.0
- Claude Code 或 OpenCode（在 PATH 中）
- OpenAI API Key（用于任务拆分）

## License

MIT
