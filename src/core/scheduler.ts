import { load_tasks, update_task } from "./splitter.js";
import {
  load_workers,
  create_worker_config,
  start_worker,
  assign_task,
  stop_worker,
  update_worker,
  get_worker_output,
} from "./worker.js";
import { start_monitor, stop_monitor } from "./monitor.js";
import { create_worktree, cleanup_all } from "../lib/worktree.js";
import { save_checkpoint, stop_checkpoint_saver } from "../lib/checkpoint.js";
import { push_progress_update } from "../server.js";
import { alert_info, alert_error, alert_warn } from "../lib/alert.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";

const SCHEDULE_INTERVAL_MS = 5_000;

let scheduler_timer: ReturnType<typeof setInterval> | null = null;
let is_running_flag = false;
let project_dir_global = "";
let idea_global = "";

export function is_running(): boolean {
  return is_running_flag;
}

/**
 * 启动调度器
 */
export function start_scheduler(project_dir: string, worker_count: number = 3, idea?: string): void {
  if (is_running_flag) {
    alert_warn("调度器已在运行中");
    return;
  }

  project_dir_global = project_dir;
  idea_global = idea || "";

  alert_info(`调度器启动 — ${worker_count} 个 Worker — 项目: ${project_dir}`);

  // 初始化 workers
  let workers = load_workers();
  if (workers.length === 0) {
    workers = create_worker_config(worker_count);
  }

  // 为每个 worker 创建 Git Worktree 并启动
  for (const worker of workers) {
    const wt_path = create_worktree(project_dir, worker.id);
    alert_info(`Worker ${worker.id} worktree: ${wt_path}`);
    start_worker(worker, wt_path);
  }

  // 启动监控器
  start_monitor(project_dir);

  is_running_flag = true;

  // 调度循环
  scheduler_timer = setInterval(() => {
    try {
      schedule_cycle();
    } catch (e) {
      alert_error("调度循环出错", { error: (e as Error).message });
    }
  }, SCHEDULE_INTERVAL_MS);

  alert_info("调度器就绪，开始分配任务...");
}

/** 停止调度器 */
export function stop_scheduler(): void {
  if (scheduler_timer) {
    clearInterval(scheduler_timer);
    scheduler_timer = null;
  }
  stop_monitor();

  const workers = load_workers();
  for (const worker of workers) {
    stop_worker(worker);
  }

  // 清理 worktree
  if (project_dir_global) {
    try { cleanup_all(project_dir_global); } catch {}
  }

  // 保存最终检查点
  if (idea_global) {
    try { save_checkpoint(idea_global, project_dir_global); } catch {}
  }

  is_running_flag = false;
  alert_info("调度器已停止");
}

/** 单次调度循环 */
function schedule_cycle(): void {
  const tasks = load_tasks();
  const workers = load_workers();

  // 检查是否全部完成
  const pending = tasks.filter((t) => t.status === "todo" || t.status === "doing");
  if (pending.length === 0) {
    const all_done = tasks.every((t) =>
      t.status === "done" || t.status === "error" || t.status === "skipped"
    );
    if (all_done && tasks.length > 0) {
      alert_info("🎉 所有任务已完成！");
      print_summary(tasks);
      stop_scheduler();
      return;
    }
  }

  // 给空闲 worker 分配任务
  const idle_workers = workers.filter((w) => w.status === "idle");
  const todo_tasks = tasks.filter((t) => t.status === "todo");

  for (const worker of idle_workers) {
    const task = pick_next_task(todo_tasks, tasks);
    if (!task) break;

    const success = assign_task(worker, task);
    if (success) {
      const idx = todo_tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) todo_tasks.splice(idx, 1);
    }
  }

  // 检查 doing 状态的任务是否实际已完成
  check_completions(tasks, workers);

  // 推送 WebSocket 更新
  push_progress_update();
}

/** 选择下一个可执行的任务 */
function pick_next_task(todo_tasks: Task[], all_tasks: Task[]): Task | null {
  const priority_order = { high: 0, medium: 1, low: 2 };
  const sorted = [...todo_tasks].sort(
    (a, b) => priority_order[a.priority] - priority_order[b.priority]
  );

  for (const task of sorted) {
    if (are_dependencies_met(task, all_tasks)) {
      return task;
    }
  }
  return null;
}

/** 检查依赖 */
function are_dependencies_met(task: Task, all_tasks: Task[]): boolean {
  if (task.dependencies.length === 0) return true;
  return task.dependencies.every((dep_id) => {
    const dep = all_tasks.find((t) => t.id === dep_id);
    return dep?.status === "done";
  });
}

/** 检查完成状态 */
function check_completions(tasks: Task[], workers: WorkerConfig[]): void {
  for (const worker of workers) {
    if (worker.status !== "busy" || !worker.current_task) continue;

    const output = get_worker_output(worker, 30);

    // 检测完成标记
    const done_markers = ["DONE", "Task completed", "任务完成", "已完成", "All tests pass"];
    const is_done = done_markers.some((m) => output.includes(m));

    if (is_done) {
      const task = tasks.find((t) => t.id === worker.current_task);
      if (task) {
        complete_task(worker, task);
      }
      continue;
    }

    // 检测明显错误
    const error_markers = ["FATAL", "CRITICAL", "panic:", "Segmentation fault"];
    const has_error = error_markers.some((m) => output.includes(m));

    if (has_error) {
      const task = tasks.find((t) => t.id === worker.current_task);
      if (task) {
        fail_task(worker, task, "检测到致命错误");
      }
    }
  }
}

/** 标记任务完成 */
function complete_task(worker: WorkerConfig, task: Task): void {
  update_task(task.id, {
    status: "done",
    completed_at: new Date().toISOString(),
  });
  update_worker(worker.id, { status: "idle", current_task: null });
  alert_info(`✅ 任务 ${task.id} 完成: ${task.title}`);
}

/** 标记任务失败，自动重试 */
function fail_task(worker: WorkerConfig, task: Task, reason: string): void {
  update_worker(worker.id, { status: "idle", current_task: null });

  if (task.retry_count < task.max_retries) {
    update_task(task.id, {
      status: "todo",
      assigned_worker: null,
      error_count: task.error_count + 1,
      last_error: reason,
      retry_count: task.retry_count + 1,
    });
    alert_warn(`任务 ${task.id} 失败 (${reason})，自动重试 ${task.retry_count + 1}/${task.max_retries}`);
  } else {
    update_task(task.id, {
      status: "error",
      error_count: task.error_count + 1,
      last_error: reason,
    });
    alert_error(`❌ 任务 ${task.id} 最终失败: ${task.title} — ${reason}`);
  }
}

/** 打印完成摘要 */
function print_summary(tasks: Task[]): void {
  const done = tasks.filter((t) => t.status === "done");
  const error = tasks.filter((t) => t.status === "error");
  const skipped = tasks.filter((t) => t.status === "skipped");

  console.log("\n" + "═".repeat(50));
  console.log("  👑 Agent-king 任务完成摘要");
  console.log("═".repeat(50));
  console.log(`  ✅ 完成:  ${done.length}`);
  console.log(`  ❌ 失败:  ${error.length}`);
  console.log(`  ⏭️  跳过:  ${skipped.length}`);
  console.log(`  📊 总计:  ${tasks.length}`);
  console.log(`  📈 成功率: ${tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0}%`);

  if (error.length > 0) {
    console.log("\n  失败的任务:");
    for (const t of error) {
      console.log(`    ❌ ${t.id}: ${t.title}`);
      console.log(`       原因: ${t.last_error}`);
    }
  }
  console.log("═".repeat(50) + "\n");
}
