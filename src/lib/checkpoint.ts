import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import { read_json, write_json } from "./store.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";

const CHECKPOINT_FILE = "checkpoint.json";

export interface Checkpoint {
  version: number;
  saved_at: string;
  idea: string;
  project_dir: string;
  tasks: Task[];
  workers: WorkerConfig[];
  scheduler_running: boolean;
  stats: {
    total: number;
    done: number;
    doing: number;
    todo: number;
    error: number;
  };
}

/** 保存检查点 */
export function save_checkpoint(idea: string, project_dir: string): void {
  const tasks = read_json<Task[]>("tasks.json", []);
  const workers = read_json<WorkerConfig[]>("workers.json", []);

  const checkpoint: Checkpoint = {
    version: 1,
    saved_at: new Date().toISOString(),
    idea,
    project_dir,
    tasks,
    workers,
    scheduler_running: true,
    stats: {
      total: tasks.length,
      done: tasks.filter((t) => t.status === "done").length,
      doing: tasks.filter((t) => t.status === "doing").length,
      todo: tasks.filter((t) => t.status === "todo").length,
      error: tasks.filter((t) => t.status === "error").length,
    },
  };

  // 备份旧检查点
  const data_dir = join(process.cwd(), "data");
  const checkpoint_path = join(data_dir, CHECKPOINT_FILE);
  if (existsSync(checkpoint_path)) {
    copyFileSync(checkpoint_path, checkpoint_path + ".bak");
  }

  write_json(CHECKPOINT_FILE, checkpoint);
}

/** 加载检查点 */
export function load_checkpoint(): Checkpoint | null {
  return read_json<Checkpoint | null>(CHECKPOINT_FILE, null);
}

/** 检查是否有可恢复的检查点 */
export function has_checkpoint(): boolean {
  const cp = load_checkpoint();
  if (!cp) return false;
  // 有未完成的任务才算有效检查点
  return cp.stats.todo > 0 || cp.stats.doing > 0;
}

/** 恢复检查点（将 doing 任务重置为 todo） */
export function restore_checkpoint(): Checkpoint | null {
  const cp = load_checkpoint();
  if (!cp) return null;

  // 将 doing 状态的任务重置为 todo（因为 Worker 已经不存在了）
  const restored_tasks = cp.tasks.map((t) => {
    if (t.status === "doing") {
      return { ...t, status: "todo" as const, assigned_worker: null };
    }
    return t;
  });

  // 写回 tasks.json
  write_json("tasks.json", restored_tasks);

  console.log(`🔄 已恢复检查点 (${cp.saved_at})`);
  console.log(`   想法: ${cp.idea}`);
  console.log(`   进度: ${cp.stats.done}/${cp.stats.total} 完成`);
  console.log(`   待执行: ${restored_tasks.filter((t) => t.status === "todo").length} 个任务`);

  return { ...cp, tasks: restored_tasks };
}

/** 定期保存检查点（每 60 秒） */
let checkpoint_timer: ReturnType<typeof setInterval> | null = null;

export function start_checkpoint_saver(idea: string, project_dir: string): void {
  if (checkpoint_timer) return;
  checkpoint_timer = setInterval(() => {
    try {
      save_checkpoint(idea, project_dir);
    } catch (e) {
      console.error(`🔴 [CHECKPOINT] 保存失败: ${(e as Error).message}`);
    }
  }, 60_000); // 每 60 秒保存一次
}

export function stop_checkpoint_saver(): void {
  if (checkpoint_timer) {
    clearInterval(checkpoint_timer);
    checkpoint_timer = null;
  }
}
