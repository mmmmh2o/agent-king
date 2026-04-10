import { read_json, write_json } from "../lib/store.js";
import { load_workers, update_worker } from "./worker.js";
import { load_tasks, update_task } from "./splitter.js";
import { alert_error, alert_warn, alert_info } from "../lib/alert.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";
import type { ProgressSnapshot } from "../types/progress.js";

const CHECK_INTERVAL_MS = 30_000; // 30 秒
const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟

let monitor_timer: ReturnType<typeof setInterval> | null = null;

/** 启动监控循环 */
export function start_monitor(project_dir: string): void {
  if (monitor_timer) return;
  alert_info("监控器启动 — 每 30 秒检查一次");

  monitor_timer = setInterval(() => {
    try {
      monitor_check();
    } catch (e) {
      alert_error("监控检查出错", { error: (e as Error).message });
    }
  }, CHECK_INTERVAL_MS);
}

/** 停止监控 */
export function stop_monitor(): void {
  if (monitor_timer) {
    clearInterval(monitor_timer);
    monitor_timer = null;
    alert_info("监控器已停止");
  }
}

/** 单次检查 */
function monitor_check(): void {
  const workers = load_workers();
  const tasks = load_tasks();
  const now = Date.now();

  for (const worker of workers) {
    if (worker.status !== "busy" || !worker.current_task) continue;

    // 检查任务是否超时
    const task = tasks.find((t) => t.id === worker.current_task);
    if (task?.started_at) {
      const elapsed = now - new Date(task.started_at).getTime();
      if (elapsed > TASK_TIMEOUT_MS) {
        alert_warn(`任务 ${task.id} 超时 (${Math.round(elapsed / 60000)}min)`, {
          task: task.id,
          worker: worker.id,
        });
        handle_task_timeout(worker, task);
      }
    }

    // 更新心跳
    update_worker(worker.id, { last_heartbeat: new Date().toISOString() });
  }

  // 更新进度快照
  update_progress_snapshot(tasks, workers);
}

/** 处理任务超时 */
function handle_task_timeout(worker: WorkerConfig, task: Task): void {
  update_worker(worker.id, { status: "idle", current_task: null });
  update_task(task.id, {
    status: "error",
    error_count: task.error_count + 1,
    last_error: "任务超时 (>30min)",
  });

  if (task.retry_count < task.max_retries) {
    alert_info(`超时任务 ${task.id} 将自动重试`);
    update_task(task.id, { status: "todo", assigned_worker: null, retry_count: task.retry_count + 1 });
  }
}

/** 更新进度快照 */
function update_progress_snapshot(tasks: Task[], workers: WorkerConfig[]): void {
  const completed = tasks.filter((t) => t.status === "done").length;
  const in_progress = tasks.filter((t) => t.status === "doing").length;
  const failed = tasks.filter((t) => t.status === "error").length;
  const skipped = tasks.filter((t) => t.status === "skipped").length;

  const snapshot: ProgressSnapshot = {
    idea: read_json<ProgressSnapshot>("progress.json", {} as ProgressSnapshot).idea || "",
    total_tasks: tasks.length,
    completed,
    in_progress,
    failed,
    skipped,
    started_at: read_json<ProgressSnapshot>("progress.json", {} as ProgressSnapshot).started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    estimated_remaining: estimate_remaining(tasks, completed),
    workers: workers.map((w) => ({
      id: w.id,
      status: w.status,
      current_task: w.current_task,
      tasks_completed: tasks.filter((t) => t.assigned_worker === w.id && t.status === "done").length,
    })),
  };

  write_json("progress.json", snapshot);
}

/** 预估剩余时间 */
function estimate_remaining(tasks: Task[], completed: number): string {
  const remaining = tasks.filter((t) => t.status === "todo" || t.status === "doing").length;
  if (remaining === 0) return "0min";
  if (completed === 0) return "估算中...";

  const done_tasks = tasks.filter((t) => t.status === "done" && t.started_at && t.completed_at);
  if (done_tasks.length === 0) return "估算中...";

  const avg_ms =
    done_tasks.reduce((sum, t) => {
      return sum + (new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime());
    }, 0) / done_tasks.length;

  const est_min = Math.round((avg_ms * remaining) / 60000);
  return `~${est_min}min`;
}
