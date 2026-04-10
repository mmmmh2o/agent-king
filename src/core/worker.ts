import { write_json, read_json, append_jsonl } from "../lib/store.js";
import { get_config } from "../lib/config.js";
import { execute_task, type CodeResult } from "../lib/coder.js";
import { update_task } from "./splitter.js";
import { alert_error, alert_warn, alert_info } from "../lib/alert.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";
import type { HookEvent } from "../types/event.js";

const DEFAULT_WORKERS_FILE = "workers.json";

// 正在执行的任务 promise 跟踪
const running_tasks = new Map<string, Promise<CodeResult>>();

/** 创建默认 worker 配置 */
export function create_worker_config(count?: number): WorkerConfig[] {
  const config = get_config();
  const n = count ?? config.worker?.count ?? 3;
  const model = config.worker?.model || "mimo";
  const workers: WorkerConfig[] = [];
  for (let i = 1; i <= n; i++) {
    workers.push({
      id: `worker-${i}`,
      max_concurrent: 1,
      model,
      tmux_session: "",
      status: "idle",
      current_task: null,
      started_at: null,
      last_heartbeat: null,
      error_count: 0,
    });
  }
  write_json(DEFAULT_WORKERS_FILE, workers);
  return workers;
}

/** 加载 worker 配置 */
export function load_workers(): WorkerConfig[] {
  return read_json<WorkerConfig[]>(DEFAULT_WORKERS_FILE, []);
}

/** 保存 worker 配置 */
export function save_workers(workers: WorkerConfig[]): void {
  write_json(DEFAULT_WORKERS_FILE, workers);
}

/** 更新单个 worker 状态 */
export function update_worker(worker_id: string, updates: Partial<WorkerConfig>): void {
  const workers = load_workers();
  const idx = workers.findIndex((w) => w.id === worker_id);
  if (idx === -1) return;
  workers[idx] = { ...workers[idx], ...updates };
  save_workers(workers);
}

/** 启动 worker（标记为就绪） */
export function start_worker(worker: WorkerConfig, project_dir: string): boolean {
  update_worker(worker.id, {
    status: "idle",
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
  });
  alert_info(`Worker ${worker.id} 已就绪`);
  return true;
}

/** 给 worker 分配任务（异步执行） */
export function assign_task(worker: WorkerConfig, task: Task, project_dir: string): boolean {
  try {
    // 更新状态
    update_worker(worker.id, {
      status: "busy",
      current_task: task.id,
      last_heartbeat: new Date().toISOString(),
    });

    update_task(task.id, {
      status: "doing",
      assigned_worker: worker.id,
      started_at: new Date().toISOString(),
    });

    // 记录事件
    const event: HookEvent = {
      task_id: task.id,
      worker_id: worker.id,
      event: "start",
      timestamp: new Date().toISOString(),
    };
    append_jsonl("events.jsonl", event);

    alert_info(`任务 ${task.id} 已分配给 ${worker.id}: ${task.title}`);

    // 异步执行
    const promise = execute_task(task.title, task.description, project_dir);
    running_tasks.set(worker.id, promise);

    promise
      .then((result) => {
        running_tasks.delete(worker.id);
        if (result.success) {
          complete_task(worker, task, result);
        } else {
          fail_task(worker, task, result.error || "Coder 返回失败");
        }
      })
      .catch((e) => {
        running_tasks.delete(worker.id);
        fail_task(worker, task, `执行异常: ${(e as Error).message}`);
      });

    return true;
  } catch (e) {
    alert_error(`分配任务失败: ${task.id} → ${worker.id}`, { error: (e as Error).message });
    return false;
  }
}

/** 检查 worker 是否忙（有正在执行的 promise） */
export function is_worker_busy(worker_id: string): boolean {
  return running_tasks.has(worker_id);
}

/** 检查 worker 是否空闲且任务已完成 */
export function check_worker_completion(worker: WorkerConfig): "busy" | "idle" {
  if (worker.status !== "busy") return "idle";
  if (running_tasks.has(worker.id)) return "busy";
  // promise 已完成但状态未更新 — 不应该到这里
  return "idle";
}

/** 标记任务完成 */
function complete_task(worker: WorkerConfig, task: Task, result: CodeResult): void {
  update_task(task.id, {
    status: "done",
    completed_at: new Date().toISOString(),
  });
  update_worker(worker.id, {
    status: "idle",
    current_task: null,
    last_heartbeat: new Date().toISOString(),
  });

  const event: HookEvent = {
    task_id: task.id,
    worker_id: worker.id,
    event: "done",
    timestamp: new Date().toISOString(),
    data: { files: result.files_written },
  };
  append_jsonl("events.jsonl", event);

  alert_info(`✅ 任务 ${task.id} 完成: ${task.title} (${result.files_written.length} 文件)`);
}

/** 标记任务失败，自动重试 */
function fail_task(worker: WorkerConfig, task: Task, reason: string): void {
  update_worker(worker.id, {
    status: "idle",
    current_task: null,
    last_heartbeat: new Date().toISOString(),
  });

  const event: HookEvent = {
    task_id: task.id,
    worker_id: worker.id,
    event: "error",
    timestamp: new Date().toISOString(),
    data: { error: reason },
  };
  append_jsonl("events.jsonl", event);

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

/** 停止 worker */
export function stop_worker(worker: WorkerConfig): void {
  running_tasks.delete(worker.id);
  update_worker(worker.id, { status: "stopped", current_task: null });
  alert_info(`Worker ${worker.id} 已停止`);
}
