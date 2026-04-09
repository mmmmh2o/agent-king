import { read_json } from "./store.js";
import { load_tasks } from "../core/splitter.js";
import { load_workers } from "../core/worker.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";

const REPORT_INTERVAL_MS = 30_000;
let report_timer: ReturnType<typeof setInterval> | null = null;
let start_time: number = 0;

/** 启动进度报告 */
export function start_reporter(): void {
  if (report_timer) return;
  start_time = Date.now();
  report_timer = setInterval(() => {
    try {
      print_progress();
    } catch (e) {
      console.error(`🔴 [REPORTER] 进度报告出错: ${(e as Error).message}`);
    }
  }, REPORT_INTERVAL_MS);
  console.log("🟢 [REPORTER] 进度报告启动 — 每 30 秒输出一次");
}

/** 停止进度报告 */
export function stop_reporter(): void {
  if (report_timer) {
    clearInterval(report_timer);
    report_timer = null;
  }
}

/** 打印当前进度 */
export function print_progress(): void {
  const tasks = load_tasks();
  const workers = load_workers();
  const elapsed = Math.round((Date.now() - start_time) / 1000);

  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const todo = tasks.filter((t) => t.status === "todo").length;
  const error = tasks.filter((t) => t.status === "error").length;
  const total = tasks.length;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = make_bar(pct);

  const active_workers = workers.filter((w) => w.status === "busy").length;
  const idle_workers = workers.filter((w) => w.status === "idle").length;

  console.log("");
  console.log(`=== 进度报告 [${format_time(elapsed)}] ===`);
  console.log(`${bar} ${pct}% (${done}/${total})`);
  console.log(`✅ 完成: ${done}  🔄 进行中: ${doing}  ⏳ 待执行: ${todo}  ❌ 失败: ${error}`);
  console.log(`🤖 Workers: ${active_workers} 忙 / ${idle_workers} 闲 / ${workers.length} 总`);

  // 显示进行中的任务
  const doing_tasks = tasks.filter((t) => t.status === "doing");
  if (doing_tasks.length > 0) {
    console.log("进行中:");
    for (const t of doing_tasks) {
      const elapsed_task = t.started_at
        ? format_time(Math.round((Date.now() - new Date(t.started_at).getTime()) / 1000))
        : "?";
      console.log(`  🔄 ${t.id}: ${t.title} (${elapsed_task}) [${t.assigned_worker}]`);
    }
  }

  // 显示最近完成的任务
  const recent_done = tasks
    .filter((t) => t.status === "done" && t.completed_at)
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
    .slice(0, 3);
  if (recent_done.length > 0) {
    console.log("最近完成:");
    for (const t of recent_done) {
      console.log(`  ✅ ${t.id}: ${t.title}`);
    }
  }

  // 异常告警
  if (error > 0) {
    console.log("⚠️ 异常任务:");
    tasks
      .filter((t) => t.status === "error")
      .forEach((t) => console.log(`  ❌ ${t.id}: ${t.title} — ${t.last_error}`));
  }

  console.log(`=== 报告结束 ===`);
  console.log("");
}

/** 生成进度条 */
function make_bar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

/** 格式化时间 */
function format_time(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}
