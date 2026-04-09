import { call_llm } from "../lib/llm.js";
import { read_json, write_json } from "../lib/store.js";
import type { Task, TaskInput } from "../types/task.js";
import { alert_error, alert_info } from "../lib/alert.js";

const SPLITTER_SYSTEM = `你是一个高级软件架构师。用户给你一个想法，你需要把它拆分成可执行的子任务列表。

每个任务应该是 AI 编码代理能独立完成的原子操作。

返回纯 JSON 数组，不要包含 markdown 代码块标记。格式：
[{"title":"任务标题","description":"详细描述（具体到可以直接执行）","priority":"high|medium|low","dependencies":["task-001"]}]

规则：
- 每个任务描述要具体到可以执行（不是"实现认证"而是"创建 /api/auth/login POST 端点，接收 email+password，返回 JWT"）
- 依赖关系标明哪些任务必须先完成
- 预估每个任务 5-15 分钟能完成
- 先做基础设施（目录结构、配置、依赖安装），再做业务逻辑，最后做测试和文档
- 不要超过 20 个任务
- 第一个任务通常是项目初始化`;

/** 解析 LLM 返回的任务列表 */
function parse_tasks_response(content: string): TaskInput[] {
  // 尝试清理 markdown 代码块
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("返回的不是数组");
    return parsed;
  } catch (e) {
    throw new Error(`任务拆分结果解析失败: ${(e as Error).message}\n原始内容: ${content.slice(0, 500)}`);
  }
}

/** 给任务分配 ID */
function assign_ids(inputs: TaskInput[]): Task[] {
  const now = new Date().toISOString();
  return inputs.map((input, i) => ({
    id: `task-${String(i + 1).padStart(3, "0")}`,
    title: input.title,
    description: input.description,
    status: "todo" as const,
    priority: input.priority || "medium",
    dependencies: input.dependencies || [],
    assigned_worker: null,
    created_at: now,
    started_at: null,
    completed_at: null,
    error_count: 0,
    last_error: null,
    git_commit: null,
    retry_count: 0,
    max_retries: 3,
  }));
}

/**
 * 拆分用户想法为子任务
 * @param idea 用户的一句话想法
 * @param project_context 可选的已有项目上下文
 * @returns 任务列表
 */
export async function split_tasks(idea: string, project_context?: string): Promise<Task[]> {
  alert_info(`开始拆分任务: "${idea}"`);

  const context_part = project_context
    ? `\n\n已有项目上下文:\n${project_context}`
    : "\n\n这是一个新项目，从零开始。";

  const prompt = `用户的想法：${idea}${context_part}`;

  const response = await call_llm(prompt, SPLITTER_SYSTEM, {
    temperature: 0.2,
    max_tokens: 4096,
  });

  const task_inputs = parse_tasks_response(response.content);
  const tasks = assign_ids(task_inputs);

  // 写入 tasks.json
  write_json("tasks.json", tasks);

  alert_info(`任务拆分完成: ${tasks.length} 个子任务`);
  return tasks;
}

/** 读取已有任务 */
export function load_tasks(): Task[] {
  return read_json<Task[]>("tasks.json", []);
}

/** 更新单个任务 */
export function update_task(task_id: string, updates: Partial<Task>): Task | null {
  const tasks = load_tasks();
  const idx = tasks.findIndex((t) => t.id === task_id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updates };
  write_json("tasks.json", tasks);
  return tasks[idx];
}
