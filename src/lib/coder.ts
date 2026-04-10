import { join, dirname, resolve } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { call_llm } from "./llm.js";
import { alert_info, alert_warn, alert_error } from "./alert.js";

export interface CodeResult {
  success: boolean;
  files_written: string[];
  error?: string;
}

const CODER_SYSTEM = `你是一个专业软件工程师。用户给你一个开发任务，你需要完成它。

## 输出格式

你必须严格按照以下 JSON 格式输出（不要包含 markdown 代码块标记）：

{
  "files": {
    "相对路径/文件名": "文件完整内容"
  },
  "message": "你做了什么的简短说明",
  "done": true
}

## 规则

1. 每个文件用相对路径作为 key，文件内容作为 value
2. 如果需要创建目录，直接在路径中体现（如 "src/utils/helper.ts"）
3. 如果是修改已有文件，返回修改后的完整内容
4. 如果任务不需要写代码（如安装依赖），files 可以为空 {}
5. message 简洁说明你做了什么
6. done 设为 true 表示任务完成
7. 不要输出任何 JSON 以外的内容
8. 代码质量要高，有类型注解，有错误处理`;

/**
 * 读取项目上下文（已有文件内容）
 * 限制读取数量和大小，避免 prompt 过长
 */
function read_project_context(project_dir: string, max_files: number = 20): string {
  const files: string[] = [];

  function walk(dir: string, prefix: string = ""): void {
    if (files.length >= max_files) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (files.length >= max_files) break;
        if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;

        const full = join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;

        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full, rel);
          } else if (st.isFile() && is_code_file(entry)) {
            const content = readFileSync(full, "utf-8");
            if (content.length < 10_000) {
              files.push(`--- ${rel} ---\n${content}`);
            }
          }
        } catch {}
      }
    } catch {}
  }

  walk(project_dir);
  return files.join("\n\n");
}

/** 判断是否是代码文件 */
function is_code_file(name: string): boolean {
  const exts = [
    ".ts", ".tsx", ".js", ".jsx", ".json", ".py", ".go", ".rs",
    ".java", ".kt", ".swift", ".rb", ".php", ".cs", ".cpp", ".c",
    ".h", ".hpp", ".md", ".yaml", ".yml", ".toml", ".ini",
    ".html", ".css", ".scss", ".vue", ".svelte", ".sh", ".bash",
  ];
  return exts.some((ext) => name.endsWith(ext));
}

/**
 * 解析 LLM 返回的 JSON
 * 处理 markdown 代码块包裹等常见情况
 */
function parse_coder_response(content: string): { files: Record<string, string>; message: string; done: boolean } {
  let cleaned = content.trim();

  // 去掉 markdown 代码块
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // 尝试提取 JSON 对象
  const json_match = cleaned.match(/\{[\s\S]*\}/);
  if (json_match) {
    cleaned = json_match[0];
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      files: parsed.files || {},
      message: parsed.message || "",
      done: parsed.done !== false,
    };
  } catch (e) {
    throw new Error(`Coder 响应解析失败: ${(e as Error).message}\n原始内容(前500字): ${content.slice(0, 500)}`);
  }
}

/**
 * 写入文件到项目目录
 * 安全校验: 拒绝路径穿越
 */
function write_files(project_dir: string, files: Record<string, string>): string[] {
  const written: string[] = [];
  const resolved_base = resolve(project_dir);

  for (const [rel_path, content] of Object.entries(files)) {
    // 安全校验: 禁止绝对路径和路径穿越
    if (rel_path.startsWith("/") || rel_path.startsWith("\\") || rel_path.includes("..")) {
      alert_warn(`拒绝写入危险路径: ${rel_path}`);
      continue;
    }

    const full_path = join(project_dir, rel_path);
    const resolved_path = resolve(full_path);

    // 确保最终路径在项目目录内
    if (!resolved_path.startsWith(resolved_base + "/") && resolved_path !== resolved_base) {
      alert_warn(`拒绝写入目录外路径: ${rel_path} -> ${resolved_path}`);
      continue;
    }

    // 确保目录存在
    const dir = dirname(full_path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(full_path, content, "utf-8");
    written.push(rel_path);
  }

  return written;
}

/**
 * 自动提交
 */
function auto_commit(project_dir: string, message: string): void {
  try {
    execSync(`git -C ${project_dir} add -A`, { stdio: "ignore" });
    execSync(
      `git -C ${project_dir} commit -m "agent-king: ${message.replace(/"/g, '\\"')}"`,
      {
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "agent-king",
          GIT_AUTHOR_EMAIL: "agent-king@local",
          GIT_COMMITTER_NAME: "agent-king",
          GIT_COMMITTER_EMAIL: "agent-king@local",
        },
      }
    );
  } catch {
    // 可能没有变更要提交
  }
}

/**
 * 执行单个开发任务
 * @param task_title 任务标题
 * @param task_description 任务描述
 * @param project_dir 项目目录（worktree 路径）
 * @param previous_tasks 已完成任务的摘要（用于上下文）
 */
export async function execute_task(
  task_title: string,
  task_description: string,
  project_dir: string,
  previous_tasks: string = ""
): Promise<CodeResult> {
  alert_info(`Coder 开始执行: ${task_title}`);

  // 读取项目上下文
  const context = read_project_context(project_dir);
  const context_section = context
    ? `\n\n## 当前项目文件:\n${context}`
    : "\n\n## 这是一个新项目，从零开始创建。";

  const prev_section = previous_tasks
    ? `\n\n## 已完成的任务:\n${previous_tasks}`
    : "";

  const prompt = `## 当前任务
标题: ${task_title}
描述: ${task_description}${prev_section}${context_section}

请完成这个任务，按照指定的 JSON 格式返回结果。`;

  try {
    const response = await call_llm(prompt, CODER_SYSTEM, {
      temperature: 0.2,
      max_tokens: 8192,
    });

    const parsed = parse_coder_response(response.content);

    // 写入文件
    let files_written: string[] = [];
    if (Object.keys(parsed.files).length > 0) {
      files_written = write_files(project_dir, parsed.files);
      alert_info(`Coder 写入 ${files_written.length} 个文件: ${files_written.join(", ")}`);

      // 自动提交
      auto_commit(project_dir, parsed.message || task_title);
    } else {
      alert_info(`Coder 无需写入文件: ${parsed.message}`);
    }

    return {
      success: parsed.done,
      files_written,
    };
  } catch (e) {
    alert_error(`Coder 执行失败: ${(e as Error).message}`);
    return {
      success: false,
      files_written: [],
      error: (e as Error).message,
    };
  }
}
