#!/usr/bin/env node

import { existsSync } from "fs";
import { resolve } from "path";
import { split_tasks, load_tasks } from "./core/splitter.js";
import { start_scheduler, stop_scheduler } from "./core/scheduler.js";
import { start_server, stop_server } from "./server.js";
import { start_reporter, stop_reporter, print_progress } from "./lib/reporter.js";
import {
  has_checkpoint,
  restore_checkpoint,
  start_checkpoint_saver,
  stop_checkpoint_saver,
} from "./lib/checkpoint.js";
import { alert_info, alert_error } from "./lib/alert.js";

const VERSION = "0.1.1";

/** 打印帮助 */
function print_help(): void {
  console.log(`
agent-king v${VERSION} — 全自动化 AI 开发调度平台

用法:
  agent-king run "你的想法"       一句话启动全自动开发
  agent-king resume              从上次断点继续执行
  agent-king serve               仅启动 Web 监控面板
  agent-king split "你的想法"     只拆分任务，不执行
  agent-king status              查看当前任务状态
  agent-king report              打印一次进度报告
  agent-king stop                停止所有 Worker

选项:
  --workers <N>                  Worker 数量 (默认 3)
  --dir <path>                   项目目录 (默认当前目录)
  --model <name>                 AI 模型 (默认 claude)
  --port <N>                     Web 面板端口 (默认 3456)
  --no-web                       不启动 Web 面板
  --yes                          自动确认执行（跳过 Enter 等待）
  --help                         显示帮助
  --version                      显示版本

示例:
  agent-king run "做一个能自动记账的 Telegram bot"
  agent-king resume
  agent-king run "重构用户模块" --workers 5 --dir ./my-project
  agent-king split "实现支付接口"
  `);
}

interface ParsedArgs {
  command: string;
  idea: string;
  workers: number;
  dir: string;
  model: string;
  port: number;
  no_web: boolean;
  yes: boolean;
}

/** 解析命令行参数 — 先提取 flags，剩余部分做 idea */
function parse_args(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    idea: "",
    workers: 3,
    dir: process.cwd(),
    model: "claude",
    port: 3456,
    no_web: false,
    yes: false,
  };

  // 第一轮：提取所有 flags
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") { print_help(); process.exit(0); }
    if (arg === "--version" || arg === "-v") { console.log(`agent-king v${VERSION}`); process.exit(0); }
    if (arg === "--no-web") { result.no_web = true; }
    else if (arg === "--yes") { result.yes = true; }
    else if (arg === "--workers") { result.workers = parseInt(args[++i], 10); }
    else if (arg === "--dir") { result.dir = resolve(args[++i]); }
    else if (arg === "--model") { result.model = args[++i]; }
    else if (arg === "--port") { result.port = parseInt(args[++i], 10); }
    else { positional.push(arg); }
    i++;
  }

  // 第二轮：从 positional 取 command 和 idea
  if (positional.length > 0) result.command = positional[0];
  if (positional.length > 1) result.idea = positional.slice(1).join(" ");

  return result;
}

/** 启动所有后台服务 */
function start_services(opts: ParsedArgs, idea: string): void {
  if (!opts.no_web) {
    start_server(opts.port);
  }
  start_reporter();
  start_checkpoint_saver(idea, opts.dir);
}

/** 停止所有后台服务 */
function stop_all(): void {
  stop_checkpoint_saver();
  stop_reporter();
  stop_scheduler();
  stop_server();
}

/** run 命令: 一句话启动 */
async function cmd_run(opts: ParsedArgs): Promise<void> {
  if (!opts.idea) {
    alert_error("请提供想法描述，例如: agent-king run \"做一个 XX\"");
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════╗
║  👑 Agent-king v${VERSION}                       ║
╠══════════════════════════════════════════════╣
║  想法: ${(opts.idea.slice(0, 38)).padEnd(38)}  ║
║  目录: ${(opts.dir.slice(0, 38)).padEnd(38)}  ║
║  Workers: ${String(opts.workers).padEnd(34)}  ║
║  模型: ${(opts.model).padEnd(38)}  ║
║  Web面板: ${(!opts.no_web ? `http://localhost:${opts.port}` : "关闭").padEnd(34)}  ║
╚══════════════════════════════════════════════╝
`);

  // 设置环境变量
  process.env.WORKER_MODEL = opts.model;

  // 1. 拆分任务
  console.log("⏳ 正在拆分任务...");
  const tasks = await split_tasks(opts.idea);

  console.log(`\n📋 拆分完成: ${tasks.length} 个子任务\n`);
  for (const t of tasks) {
    const dep = t.dependencies.length > 0 ? ` ← [${t.dependencies.join(", ")}]` : "";
    const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
    console.log(`  ${pri} ${t.id}: ${t.title}${dep}`);
  }

  // 2. 等待用户确认（--yes 跳过）
  if (opts.yes) {
    console.log("\n⚡ 自动开始 (--yes)");
  } else {
    console.log("\n按 Enter 开始执行，Ctrl+C 取消...");
    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", () => {
        process.stdin.pause();
        resolve();
      });
    });
  }

  // 3. 启动所有服务
  start_services(opts, opts.idea);

  // 4. 启动调度器
  start_scheduler(opts.dir, opts.workers);
}

/** resume 命令: 从断点继续 */
async function cmd_resume(opts: ParsedArgs): Promise<void> {
  if (!has_checkpoint()) {
    alert_error("没有可恢复的检查点。先运行 agent-king run \"想法\" 创建任务。");
    process.exit(1);
  }

  const cp = restore_checkpoint();
  if (!cp) {
    alert_error("检查点恢复失败");
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════╗
║  🔄 Agent-king 恢复执行                       ║
╠══════════════════════════════════════════════╣
║  想法: ${(cp.idea.slice(0, 38)).padEnd(38)}  ║
║  进度: ${(`${cp.stats.done}/${cp.stats.total} 完成`).padEnd(38)}  ║
║  待执行: ${(String(cp.tasks.filter((t) => t.status === "todo").length) + " 个任务").padEnd(35)}  ║
╚══════════════════════════════════════════════╝
`);

  process.env.WORKER_MODEL = opts.model;
  start_services(opts, cp.idea);
  start_scheduler(cp.project_dir || opts.dir, opts.workers);
}

/** split 命令: 只拆分任务 */
async function cmd_split(idea: string): Promise<void> {
  if (!idea) {
    alert_error("请提供想法描述");
    process.exit(1);
  }
  const tasks = await split_tasks(idea);
  console.log(`\n📋 任务已拆分 (${tasks.length} 个):\n`);
  for (const t of tasks) {
    const dep = t.dependencies.length > 0 ? ` ← [${t.dependencies.join(", ")}]` : "";
    console.log(`  ${t.id} [${t.priority}] ${t.title}${dep}`);
    console.log(`       ${t.description}`);
  }
  console.log(`\n已保存到 data/tasks.json`);
}

/** status 命令 */
function cmd_status(): void {
  const tasks = load_tasks();
  if (tasks.length === 0) {
    console.log("没有任务。运行 agent-king run \"想法\" 开始。");
    return;
  }
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const todo = tasks.filter((t) => t.status === "todo").length;
  const error = tasks.filter((t) => t.status === "error").length;
  const pct = Math.round((done / tasks.length) * 100);

  console.log(`\n📊 任务状态: ${pct}% 完成`);
  console.log(`  ✅ 完成: ${done}  🔄 进行中: ${doing}  ⏳ 待执行: ${todo}  ❌ 失败: ${error}  📊 总计: ${tasks.length}`);

  if (has_checkpoint()) {
    console.log("  💾 有可恢复的检查点 — 运行 agent-king resume 继续");
  }

  if (doing > 0) {
    console.log("\n进行中的任务:");
    tasks.filter((t) => t.status === "doing")
      .forEach((t) => console.log(`  🔄 ${t.id}: ${t.title} [${t.assigned_worker}]`));
  }
  if (error > 0) {
    console.log("\n失败的任务:");
    tasks.filter((t) => t.status === "error")
      .forEach((t) => console.log(`  ❌ ${t.id}: ${t.title} — ${t.last_error}`));
  }
}

/** report 命令 */
function cmd_report(): void {
  print_progress();
}

/** stop 命令 */
function cmd_stop(): void {
  stop_all();
  console.log("已停止所有服务。");
}

/** serve 命令 */
function cmd_serve(port: number): void {
  start_server(port);
  console.log(`Web 面板: http://localhost:${port}  (Ctrl+C 退出)`);
}

/** 优雅退出 */
function setup_graceful_exit(): void {
  const handler = () => {
    console.log("\n\n⏹️  正在停止...");
    stop_all();
    process.exit(0);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

/** 主入口 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) { print_help(); process.exit(0); }

  const opts = parse_args(args);
  setup_graceful_exit();

  switch (opts.command) {
    case "run":    await cmd_run(opts); break;
    case "resume": await cmd_resume(opts); break;
    case "split":  await cmd_split(opts.idea); break;
    case "status": cmd_status(); break;
    case "report": cmd_report(); break;
    case "stop":   cmd_stop(); break;
    case "serve":  cmd_serve(opts.port); break;
    default:
      console.error(`未知命令: ${opts.command}`);
      print_help();
      process.exit(1);
  }
}

main().catch((e) => {
  alert_error(`致命错误: ${e.message}`);
  process.exit(1);
});
