import { join } from "path";
import * as tmux from "../lib/tmux.js";
import { read_json, write_json, append_jsonl } from "../lib/store.js";
import { update_task } from "./splitter.js";
import { alert_error, alert_warn, alert_info } from "../lib/alert.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig, WorkerStatus } from "../types/worker.js";
import type { HookEvent } from "../types/event.js";

const DEFAULT_WORKERS_FILE = "workers.json";

/** 创建默认 worker 配置 */
export function create_worker_config(count: number = 3): WorkerConfig[] {
  const workers: WorkerConfig[] = [];
  for (let i = 1; i <= count; i++) {
    workers.push({
      id: `worker-${i}`,
      max_concurrent: 1,
      model: process.env.WORKER_MODEL || "claude",
      tmux_session: `agent-king-w${i}`,
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

/** 启动一个 worker（创建 tmux session + 启动 Claude Code） */
export function start_worker(worker: WorkerConfig, project_dir: string): boolean {
  try {
    if (tmux.has_session(worker.tmux_session)) {
      tmux.kill_session(worker.tmux_session);
    }
    tmux.new_session(worker.tmux_session, project_dir);

    // 等一小会儿让 session 就绪
    // 启动 Claude Code (或 OpenCode)
    const cli_cmd = worker.model === "opencode" ? "opencode" : "claude";
    tmux.send_keys(worker.tmux_session, cli_cmd);

    update_worker(worker.id, {
      status: "idle",
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
    });

    alert_info(`Worker ${worker.id} 已启动 (session: ${worker.tmux_session})`);
    return true;
  } catch (e) {
    alert_error(`Worker ${worker.id} 启动失败`, { error: (e as Error).message });
    update_worker(worker.id, { status: "error" });
    return false;
  }
}

/** 给 worker 分配任务 */
export function assign_task(worker: WorkerConfig, task: Task): boolean {
  try {
    const prompt = build_task_prompt(task);
    tmux.send_keys(worker.tmux_session, prompt);

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
    return true;
  } catch (e) {
    alert_error(`分配任务失败: ${task.id} → ${worker.id}`, { error: (e as Error).message });
    return false;
  }
}

/** 停止 worker */
export function stop_worker(worker: WorkerConfig): void {
  try {
    if (tmux.has_session(worker.tmux_session)) {
      tmux.send_keys(worker.tmux_session, "C-c", false);
      setTimeout(() => tmux.kill_session(worker.tmux_session), 1000);
    }
    update_worker(worker.id, { status: "stopped", current_task: null });
    alert_info(`Worker ${worker.id} 已停止`);
  } catch (e) {
    alert_warn(`停止 Worker ${worker.id} 时出错`, { error: (e as Error).message });
  }
}

/** 构建任务 prompt */
function build_task_prompt(task: Task): string {
  const parts = [
    `任务: ${task.title}`,
    `描述: ${task.description}`,
    "",
    "要求:",
    "- 完成后运行 git add -A && git commit -m 'task: <描述>'",
    "- 如果遇到错误，尝试修复后再继续",
    "- 完成后输出 DONE",
  ];

  if (task.dependencies.length > 0) {
    parts.splice(2, 0, `依赖: ${task.dependencies.join(", ")}（这些任务已完成）`);
  }

  return parts.join("\n");
}

/** 获取 worker 的终端输出 */
export function get_worker_output(worker: WorkerConfig, lines?: number): string {
  if (!tmux.has_session(worker.tmux_session)) return "";
  return tmux.capture_pane(worker.tmux_session, lines);
}
