import { join } from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import * as tmux from "../lib/tmux.js";
import { read_json, write_json, append_jsonl } from "../lib/store.js";
import { update_task } from "./splitter.js";
import { call_llm } from "../lib/llm.js";
import { alert_error, alert_warn, alert_info } from "../lib/alert.js";
import type { Task } from "../types/task.js";
import type { WorkerConfig } from "../types/worker.js";
import type { HookEvent } from "../types/event.js";

const DEFAULT_WORKERS_FILE = "workers.json";

const WORKER_SYSTEM = `你是一个专业的 AI 编码代理。

用户会给你一个具体的开发任务。你需要：
1. 编写所有必要的代码文件
2. 运行代码验证
3. 修复任何错误

输出格式（必须严格遵守）：
在最后，输出一个 JSON 代码块：
\`\`\`result
{"status":"done","files":{"path/to/file":"content"},"commands":["command to run"],"summary":"简短描述完成了什么"}
\`\`\`

规则：
- files: 所有需要创建/修改的文件的完整内容
- commands: 需要执行的命令（按顺序）
- 如果失败，输出 status:"error" 和 error 字段
- 代码要完整可用，不要省略
- 不要创建 package.json（已有项目结构）`;

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

/** 启动一个 worker */
export function start_worker(worker: WorkerConfig, project_dir: string): boolean {
  try {
    if (tmux.has_session(worker.tmux_session)) {
      tmux.kill_session(worker.tmux_session);
    }
    tmux.new_session(worker.tmux_session, project_dir);

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

/**
 * 给 worker 分配任务 — 直接调 LLM API 生成代码
 * 不依赖外部 CLI（Claude Code / OpenCode）
 */
export function assign_task(worker: WorkerConfig, task: Task): boolean {
  // 异步执行，不阻塞调度循环
  execute_task_async(worker, task).catch(e => {
    alert_error(`任务 ${task.id} 异常: ${e.message}`);
    handle_task_error(worker, task, e.message);
  });

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

  const event: HookEvent = {
    task_id: task.id,
    worker_id: worker.id,
    event: "start",
    timestamp: new Date().toISOString(),
  };
  append_jsonl("events.jsonl", event);

  alert_info(`任务 ${task.id} 已分配给 ${worker.id}: ${task.title}`);
  return true;
}

/** 异步执行任务 */
async function execute_task_async(worker: WorkerConfig, task: Task): Promise<void> {
  alert_info(`Worker ${worker.id} 开始执行: ${task.title}`);

  // 构建 prompt
  const prompt = build_task_prompt(task);

  // 记录 pre_tool_use 事件
  append_jsonl("events.jsonl", {
    task_id: task.id, worker_id: worker.id,
    event: "pre_tool_use", tool: "llm_call",
    timestamp: new Date().toISOString(),
  });

  // 调用 LLM
  const response = await call_llm(prompt, WORKER_SYSTEM, {
    temperature: 0.2,
    max_tokens: 8192,
  });

  // 记录 post_tool_use 事件
  append_jsonl("events.jsonl", {
    task_id: task.id, worker_id: worker.id,
    event: "post_tool_use", tool: "llm_call",
    timestamp: new Date().toISOString(),
  });

  // 解析结果
  const result = parse_result(response.content);

  if (!result) {
    handle_task_error(worker, task, "LLM 返回格式无法解析");
    return;
  }

  if (result.status === "error") {
    handle_task_error(worker, task, result.error || "LLM 报告执行失败");
    return;
  }

  // 写入文件
  if (result.files) {
    for (const [filepath, content] of Object.entries(result.files)) {
      const full_path = join(process.cwd(), filepath);
      const dir = join(full_path, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(full_path, content, "utf-8");
      alert_info(`Worker ${worker.id} 写入: ${filepath} (${content.length} chars)`);
    }
  }

  // 执行命令
  if (result.commands && result.commands.length > 0) {
    for (const cmd of result.commands) {
      try {
        alert_info(`Worker ${worker.id} 执行: ${cmd}`);
        const output = execSync(cmd, {
          encoding: "utf-8",
          timeout: 60_000,
          cwd: process.cwd(),
        });
        alert_info(`输出: ${output.slice(0, 200)}`);
      } catch (e) {
        alert_warn(`命令执行失败: ${cmd} — ${(e as Error).message.slice(0, 100)}`);
        // 命令失败不终止任务，继续执行下一个命令
      }
    }
  }

  // 标记完成
  handle_task_done(worker, task, result.summary || "完成");
}

/** 解析 LLM 返回的 result JSON */
function parse_result(content: string): { status: string; files?: Record<string, string>; commands?: string[]; summary?: string; error?: string } | null {
  // 尝试提取 ```result ... ``` 块
  const match = content.match(/```result\s*\n([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  // 尝试找 JSON 对象
  const json_match = content.match(/\{[\s\S]*"status"[\s\S]*\}/);
  if (json_match) {
    try {
      return JSON.parse(json_match[0]);
    } catch {}
  }

  return null;
}

/** 处理任务完成 */
function handle_task_done(worker: WorkerConfig, task: Task, summary: string): void {
  update_task(task.id, {
    status: "done",
    completed_at: new Date().toISOString(),
  });
  update_worker(worker.id, { status: "idle", current_task: null });

  append_jsonl("events.jsonl", {
    task_id: task.id, worker_id: worker.id,
    event: "stop", summary,
    timestamp: new Date().toISOString(),
  });

  alert_info(`✅ 任务 ${task.id} 完成: ${task.title} — ${summary}`);
}

/** 处理任务错误 */
function handle_task_error(worker: WorkerConfig, task: Task, error: string): void {
  update_worker(worker.id, { status: "idle", current_task: null });

  const current_task = read_json<Task[]>("tasks.json", []).find(t => t.id === task.id);
  const retry_count = current_task?.retry_count || 0;

  if (retry_count < task.max_retries) {
    update_task(task.id, {
      status: "todo",
      assigned_worker: null,
      error_count: (current_task?.error_count || 0) + 1,
      last_error: error.slice(0, 200),
      retry_count: retry_count + 1,
    });
    alert_warn(`任务 ${task.id} 失败，自动重试 ${retry_count + 1}/${task.max_retries}: ${error.slice(0, 100)}`);
  } else {
    update_task(task.id, {
      status: "error",
      error_count: (current_task?.error_count || 0) + 1,
      last_error: error.slice(0, 200),
    });
    alert_error(`❌ 任务 ${task.id} 最终失败: ${error.slice(0, 100)}`);
  }
}

/** 停止 worker */
export function stop_worker(worker: WorkerConfig): void {
  try {
    if (tmux.has_session(worker.tmux_session)) {
      tmux.kill_session(worker.tmux_session);
    }
    update_worker(worker.id, { status: "stopped", current_task: null });
    alert_info(`Worker ${worker.id} 已停止`);
  } catch (e) {
    alert_warn(`停止 Worker ${worker.id} 时出错`, { error: (e as Error).message });
  }
}

/** 检测 worker 是否空闲 — 基于状态而非 tmux */
export function is_worker_idle(worker: WorkerConfig): boolean {
  return worker.status === "idle";
}

/** 构建任务 prompt */
function build_task_prompt(task: Task): string {
  const parts = [
    `## 任务`,
    `标题: ${task.title}`,
    `描述: ${task.description}`,
  ];

  if (task.dependencies.length > 0) {
    parts.push(`\n前置依赖任务 (已完成): ${task.dependencies.join(", ")}`);
  }

  parts.push(
    "",
    "请编写所有必要的代码文件，执行验证命令，然后返回结果。",
    "用 ```result 块返回执行结果。"
  );

  return parts.join("\n");
}

/** 获取 worker 的终端输出 */
export function get_worker_output(worker: WorkerConfig, lines?: number): string {
  if (!tmux.has_session(worker.tmux_session)) return "";
  return tmux.capture_pane(worker.tmux_session, lines);
}
