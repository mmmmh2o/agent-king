import * as tmux from "../lib/tmux.js";
import { read_json, write_json } from "../lib/store.js";
import { load_workers, update_worker, get_worker_output, is_worker_idle } from "./worker.js";
import { load_tasks, update_task } from "./splitter.js";
import { alert_error, alert_warn, alert_info } from "../lib/alert.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";
import type { ProgressSnapshot } from "../types/progress.js";

const CHECK_INTERVAL_MS = 30_000; // 30 秒
const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
const CONTEXT_THRESHOLD = 0.7; // 70%
const IDLE_THRESHOLD = 3; // 连续 3 次检测到空闲（即 90s 无活动）才确认完成

// 跟踪每个 worker 的连续空闲次数
const idle_counts: Map<string, number> = new Map();

let monitor_timer: ReturnType<typeof setInterval> | null = null;

/** 启动监控循环 */
export function start_monitor(project_dir: string): void {
  if (monitor_timer) return;
  alert_info("监控器启动 — 每 30 秒检查一次");

  monitor_timer = setInterval(() => {
    try {
      monitor_check(project_dir);
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
    idle_counts.clear();
    alert_info("监控器已停止");
  }
}

/** 单次检查 */
function monitor_check(project_dir: string): void {
  const workers = load_workers();
  const tasks = load_tasks();
  const now = Date.now();

  for (const worker of workers) {
    if (worker.status !== "busy" || !worker.current_task) continue;

    // 1. 检查 tmux session 是否还活着
    if (!tmux.has_session(worker.tmux_session)) {
      // session 消失 — 可能是进程正常退出（print 模式完成）或崩溃
      const task = tasks.find((t) => t.id === worker.current_task);
      if (task) {
        const elapsed = task.started_at ? now - new Date(task.started_at).getTime() : 0;
        if (elapsed > 10_000) {
          // 运行超过 10s 才消失，视为完成
          handle_task_done(worker, task);
        } else {
          // 运行不到 10s 就消失，可能是崩溃
          handle_worker_dead(worker, task.id);
        }
      }
      continue;
    }

    // 2. 检查任务是否超时
    const task = tasks.find((t) => t.id === worker.current_task);
    if (task?.started_at) {
      const elapsed = now - new Date(task.started_at).getTime();
      if (elapsed > TASK_TIMEOUT_MS) {
        alert_warn(`任务 ${task.id} 超时 (${Math.round(elapsed / 60000)}min)`, {
          task: task.id, worker: worker.id,
        });
        handle_task_timeout(worker, task);
        continue;
      }
    }

    // 3. 检测空闲完成（连续 N 次检测到 idle = 完成）
    if (task && is_worker_idle(worker)) {
      const count = (idle_counts.get(worker.id) || 0) + 1;
      idle_counts.set(worker.id, count);

      if (count >= IDLE_THRESHOLD) {
        alert_info(`Worker ${worker.id} 空闲 ${count} 次 → 任务 ${task.id} 标记完成`);
        handle_task_done(worker, task);
        idle_counts.delete(worker.id);
        continue;
      }
    } else {
      idle_counts.delete(worker.id);
    }

    // 4. 检查上下文占用
    try {
      const output = get_worker_output(worker, 50);
      const context_match = output.match(/(\d+)\s*%\s*(?:context|Context|上下文)/);
      if (context_match) {
        const pct = parseInt(context_match[1], 10) / 100;
        if (pct > CONTEXT_THRESHOLD) {
          alert_warn(`Worker ${worker.id} 上下文占用 ${Math.round(pct * 100)}%`, {
            worker: worker.id, task: worker.current_task,
          });
          handle_context_overflow(worker, task!, project_dir);
        }
      }
    } catch {
      // 解析失败不影响主流程
    }

    // 5. 更新心跳
    update_worker(worker.id, { last_heartbeat: new Date().toISOString() });
  }

  // 更新进度快照
  update_progress_snapshot(tasks, workers);
}

/** 处理任务完成 */
function handle_task_done(worker: WorkerConfig, task: Task): void {
  update_task(task.id, {
    status: "done",
    completed_at: new Date().toISOString(),
  });
  update_worker(worker.id, { status: "idle", current_task: null });

  const event = {
    task_id: task.id, worker_id: worker.id, event: "done",
    timestamp: new Date().toISOString(),
  };
  import("../lib/store.js").then(m => m.append_jsonl("events.jsonl", event));

  alert_info(`✅ 任务 ${task.id} 完成: ${task.title}`);
}

/** 处理 worker 进程消失 */
function handle_worker_dead(worker: WorkerConfig, task_id: string): void {
  update_worker(worker.id, { status: "error", current_task: null });
  const task = update_task(task_id, {
    status: "error",
    error_count: (load_tasks().find((t) => t.id === task_id)?.error_count || 0) + 1,
    last_error: "Worker 进程异常退出 (<10s)",
  });

  if (task && task.retry_count < task.max_retries) {
    alert_info(`任务 ${task_id} 将自动重试 (${task.retry_count + 1}/${task.max_retries})`);
    update_task(task_id, { status: "todo", assigned_worker: null, retry_count: task.retry_count + 1 });
  } else {
    alert_error(`❌ 任务 ${task_id} 失败且已达最大重试次数`);
  }
}

/** 处理任务超时 */
function handle_task_timeout(worker: WorkerConfig, task: Task): void {
  tmux.kill_session(worker.tmux_session);
  update_worker(worker.id, { status: "idle", current_task: null });
  update_task(task.id, {
    status: "error",
    error_count: task.error_count + 1,
    last_error: "任务超时 (>30min)",
  });

  if (task.retry_count < task.max_retries) {
    alert_info(`超时任务 ${task.id} 将自动重试`);
    update_task(task.id, { status: "todo", assigned_worker: null, retry_count: task.retry_count + 1 });
  } else {
    alert_error(`❌ 任务 ${task.id} 超时且已达最大重试次数`);
  }
}

/** 处理上下文溢出 */
function handle_context_overflow(worker: WorkerConfig, task: Task, project_dir: string): void {
  tmux.kill_session(worker.tmux_session);
  alert_info(`重建 Worker ${worker.id} session...`);

  setTimeout(() => {
    tmux.new_session(worker.tmux_session, project_dir);
    const cli_cmd = worker.model === "opencode" ? "opencode" : "claude";
    tmux.send_keys(worker.tmux_session, cli_cmd);

    setTimeout(() => {
      const prompt = `请继续完成任务: ${task.title}\n${task.description}`;
      tmux.send_keys(worker.tmux_session, prompt);
      update_worker(worker.id, { last_heartbeat: new Date().toISOString() });
      alert_info(`Worker ${worker.id} 已重建，任务 ${task.id} 已重新发送`);
    }, 3000);
  }, 2000);
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
