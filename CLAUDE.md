# CLAUDE.md — Agent-king 开发协作规范

## 项目概要
全自动化 AI 开发调度平台。一句话启动 → 自动拆任务 → 多 Agent 并行执行 → 实时监控 → 完成交付。

## 技术栈
- **后端**: Node.js + TypeScript (strict mode)
- **进程管理**: tmux (每个 Worker 一个独立 session)
- **实时通信**: WebSocket
- **存储**: JSON/JSONL 文件 (data/ 目录)
- **前端**: 内嵌 HTML Dashboard (server.ts)

## 命令
```bash
npm run build          # 编译 TypeScript
npm start              # 运行
npx tsx src/index.ts   # 开发模式
node dist/index.js run "想法"    # 一句话启动
node dist/index.js serve         # 仅启动 Web 面板
```

## 编码规范
- **命名**: snake_case (变量、函数、文件名)
- **类型**: TypeScript strict, 所有函数参数和返回值必须有类型
- **错误处理**: guard early, 函数顶部检查, 提前返回
- **日志**: 使用 alert() 系列函数, 不要 console.log
- **文件长度**: 单文件不超过 300 行
- **函数长度**: 单函数不超过 50 行

## 架构要点
```
用户输入 → Task Splitter (LLM) → tasks.json
                                      ↓
         Scheduler (5s 循环) ← 读取 tasks.json
              ↓
         分配给空闲 Worker (tmux session)
              ↓
         Monitor (30s 轮询) → 异常检测 → 告警
              ↓
         Hooks Receiver → events.jsonl → WebSocket → Dashboard
```

## 关键文件
| 文件 | 作用 |
|------|------|
| src/index.ts | CLI 入口 |
| src/server.ts | HTTP + WebSocket + Dashboard |
| src/core/splitter.ts | LLM 任务拆分 |
| src/core/scheduler.ts | 调度循环 |
| src/core/worker.ts | tmux Worker 管理 |
| src/core/monitor.ts | 30 秒监控 |
| src/lib/tmux.ts | tmux 操作封装 |
| src/lib/store.ts | JSON 文件读写 |
| src/lib/llm.ts | LLM API 调用 |
| src/lib/alert.ts | 告警系统 |

## 不做的事
- 不引入重型框架 (Express 够用就不上 NestJS)
- 不用数据库 (JSON 文件够用)
- 不做用户系统 (单用户工具)
- 不做移动端适配
