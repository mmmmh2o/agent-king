import { join, dirname, resolve, extname } from "path";
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
 * 构建 Repo Map：只提取符号摘要，不传完整文件内容
 * 用正则提取函数、类、接口、类型定义、常量等签名
 */
export function build_repo_map(project_dir: string, max_files: number = 30): string {
  const entries: string[] = [];

  function walk(dir: string, prefix: string = ""): void {
    if (entries.length >= max_files) return;
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (entries.length >= max_files) break;
        if (should_skip(item)) continue;

        const full = join(dir, item);
        const rel = prefix ? `${prefix}/${item}` : item;

        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full, rel);
          } else if (st.isFile() && is_code_file(item)) {
            const content = readFileSync(full, "utf-8");
            const symbols = extract_symbols(content, item);
            if (symbols.length > 0) {
              entries.push(`📄 ${rel}:\n${symbols.join("\n")}`);
            } else {
              // 没有符号的小文件，展示全部（< 30 行）
              const lines = content.split("\n");
              if (lines.length <= 30) {
                entries.push(`📄 ${rel}:\n${content}`);
              } else {
                entries.push(`📄 ${rel}: (${lines.length} lines, no top-level symbols)`);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  walk(project_dir);
  return entries.join("\n\n");
}

/** 提取文件中的符号签名（函数、类、接口等） */
function extract_symbols(content: string, filename: string): string[] {
  const symbols: string[] = [];
  const ext = extname(filename).toLowerCase();

  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    extract_js_symbols(content, symbols);
  } else if ([".py"].includes(ext)) {
    extract_py_symbols(content, symbols);
  } else if ([".go"].includes(ext)) {
    extract_go_symbols(content, symbols);
  } else if ([".rs"].includes(ext)) {
    extract_rs_symbols(content, symbols);
  } else if ([".json"].includes(ext)) {
    // JSON: 只展示顶层 key
    try {
      const obj = JSON.parse(content);
      if (typeof obj === "object" && obj !== null) {
        symbols.push(`{ ${Object.keys(obj).join(", ")} }`);
      }
    } catch {}
  }

  return symbols;
}

/** 提取 JS/TS 符号 */
function extract_js_symbols(content: string, symbols: string[]): void {
  // 函数声明
  for (const m of content.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\n{]+))?/gm)) {
    const ret = m[3] ? `: ${m[3].trim()}` : "";
    symbols.push(`  function ${m[1]}(${m[2].trim()})${ret}`);
  }

  // 箭头函数 / const fn = ...
  for (const m of content.matchAll(/^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^\n=]+))?\s*=>/gm)) {
    const ret = m[3] ? `: ${m[3].trim()}` : "";
    symbols.push(`  const ${m[1]} = (${m[2].trim()})${ret} => ...`);
  }

  // 类声明
  for (const m of content.matchAll(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\n{]+))?/gm)) {
    let decl = `  class ${m[1]}`;
    if (m[2]) decl += ` extends ${m[2]}`;
    if (m[3]) decl += ` implements ${m[3].trim()}`;
    symbols.push(decl);

    // 类内的方法
    const classStart = m.index! + m[0].length;
    const classBody = extract_class_body(content, classStart);
    for (const method of classBody.matchAll(/^\s+(?:public|private|protected|static|async|readonly|\s)*\s*(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\n{]+))?/gm)) {
      symbols.push(`    ${method[1]}(${method[2].trim()})${method[3] ? `: ${method[3].trim()}` : ""}`);
    }
  }

  // 接口声明
  for (const m of content.matchAll(/^\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^\n{]+))?/gm)) {
    symbols.push(`  interface ${m[1]}${m[2] ? ` extends ${m[2].trim()}` : ""}`);
  }

  // 类型别名
  for (const m of content.matchAll(/^\s*(?:export\s+)?type\s+(\w+)/gm)) {
    symbols.push(`  type ${m[1]}`);
  }

  // 导出常量
  for (const m of content.matchAll(/^\s*export\s+(?:const|let)\s+(\w+)/gm)) {
    symbols.push(`  export const ${m[1]}`);
  }
}

/** 提取 Python 符号 */
function extract_py_symbols(content: string, symbols: string[]): void {
  for (const m of content.matchAll(/^(?:class\s+(\w+)(?:\(([^)]*)\))?)|(?:def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^\n:]+))?)/gm)) {
    if (m[1]) {
      symbols.push(`  class ${m[1]}${m[2] ? `(${m[2]})` : ""}`);
    } else if (m[3]) {
      const ret = m[5] ? ` -> ${m[5].trim()}` : "";
      symbols.push(`  def ${m[3]}(${m[4].trim()})${ret}`);
    }
  }
}

/** 提取 Go 符号 */
function extract_go_symbols(content: string, symbols: string[]): void {
  for (const m of content.matchAll(/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|([^\n{]+))?/gm)) {
    const ret = m[3] ? `(${m[3]})` : (m[4] ? m[4].trim() : "");
    symbols.push(`  func ${m[1]}(${m[2].trim()}) ${ret}`.trim());
  }
  for (const m of content.matchAll(/^type\s+(\w+)\s+(struct|interface)/gm)) {
    symbols.push(`  type ${m[1]} ${m[2]}`);
  }
}

/** 提取 Rust 符号 */
function extract_rs_symbols(content: string, symbols: string[]): void {
  for (const m of content.matchAll(/^\s*(?:pub\s+)?(?:fn|struct|enum|trait|impl|type)\s+(\w+)/gm)) {
    symbols.push(`  ${m[0].trim().split("{")[0].trim()}`);
  }
}

/** 提取类体（简单的大括号匹配） */
function extract_class_body(content: string, start: number): string {
  let depth = 0;
  let begun = false;
  let end = start;
  for (let i = start; i < content.length && i < start + 10000; i++) {
    if (content[i] === "{") { depth++; begun = true; }
    if (content[i] === "}") { depth--; }
    if (begun && depth === 0) { end = i; break; }
  }
  return content.slice(start, end);
}

/**
 * 读取与当前任务相关的文件内容
 * 根据任务描述中的关键词匹配文件名，只读最相关的文件
 */
function read_relevant_files(
  project_dir: string,
  task_title: string,
  task_description: string,
  max_files: number = 3,
  max_lines_per_file: number = 200
): string {
  const all_files = list_code_files(project_dir);
  if (all_files.length === 0) return "";

  // 提取任务关键词
  const keywords = extract_keywords(task_title + " " + task_description);

  // 给每个文件打分
  const scored = all_files.map(f => ({
    path: f,
    score: score_file_relevance(f, read_first_n(join(project_dir, f), 5), keywords),
  }));

  // 取得分最高的 N 个文件
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, max_files);

  const parts: string[] = [];
  for (const { path } of selected) {
    const full = join(project_dir, path);
    const content = read_first_n(full, max_lines_per_file);
    const total_lines = count_lines(full);
    const truncated = total_lines > max_lines_per_file
      ? `\n... (${total_lines - max_lines_per_file} more lines)`
      : "";
    parts.push(`--- ${path} ---\n${content}${truncated}`);
  }

  return parts.join("\n\n");
}

/** 列出所有代码文件 */
function list_code_files(dir: string, prefix: string = ""): string[] {
  const files: string[] = [];
  try {
    for (const item of readdirSync(dir)) {
      if (should_skip(item)) continue;
      const full = join(dir, item);
      const rel = prefix ? `${prefix}/${item}` : item;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          files.push(...list_code_files(full, rel));
        } else if (st.isFile() && is_code_file(item)) {
          files.push(rel);
        }
      } catch {}
    }
  } catch {}
  return files;
}

/** 读文件前 N 行 */
function read_first_n(filepath: string, n: number): string {
  try {
    const content = readFileSync(filepath, "utf-8");
    const lines = content.split("\n");
    return lines.slice(0, n).join("\n");
  } catch {
    return "";
  }
}

/** 计算文件行数 */
function count_lines(filepath: string): number {
  try {
    return readFileSync(filepath, "utf-8").split("\n").length;
  } catch {
    return 0;
  }
}

/** 从任务描述中提取关键词 */
function extract_keywords(text: string): string[] {
  // 提取驼峰、下划线命名的词，文件扩展名，常见编程术语
  const words = text.match(/[a-zA-Z_]\w{2,}|\.([a-z]+)/g) || [];
  // 过滤常见无意义词
  const stop = new Set(["the", "and", "for", "that", "this", "with", "from", "has", "are", "was", "were", "been"]);
  return words.filter(w => !stop.has(w.toLowerCase())).map(w => w.toLowerCase());
}

/** 给文件相关性打分 */
function score_file_relevance(filepath: string, first_lines: string, keywords: string[]): number {
  let score = 0;
  const lower = filepath.toLowerCase();
  const content_lower = (first_lines || "").toLowerCase();

  for (const kw of keywords) {
    if (lower.includes(kw)) score += 3;
    if (content_lower.includes(kw)) score += 1;
  }

  // 新建文件的目录包含关键词加分
  for (const kw of keywords) {
    if (lower.includes("/" + kw) || lower.includes(kw + "/")) score += 2;
  }

  return score;
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

/** 跳过不需要的目录/文件 */
function should_skip(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name === "dist" || name === "__pycache__";
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
 *
 * 上下文策略:
 * 1. 先构建 Repo Map（符号摘要）作为全局概览
 * 2. 再读取与任务最相关的 N 个文件（有限行数）
 * 3. 总体 token 消耗可控
 */
export async function execute_task(
  task_title: string,
  task_description: string,
  project_dir: string,
  previous_tasks: string = ""
): Promise<CodeResult> {
  alert_info(`Coder 开始执行: ${task_title}`);

  // 1. 构建 Repo Map（全局符号摘要，不传全文）
  const repo_map = build_repo_map(project_dir, 20);
  const map_section = repo_map
    ? `\n\n## 项目结构 (符号摘要):\n${repo_map}`
    : "";

  // 2. 读取与任务最相关的文件（全文，但有限行数）
  const relevant = read_relevant_files(project_dir, task_title, task_description, 3, 300);
  const relevant_section = relevant
    ? `\n\n## 相关文件:\n${relevant}`
    : "";

  // 3. 已完成任务摘要
  const prev_section = previous_tasks
    ? `\n\n## 已完成的任务:\n${previous_tasks}`
    : "";

  const prompt = `## 当前任务
标题: ${task_title}
描述: ${task_description}${prev_section}${map_section}${relevant_section}

请完成这个任务，按照指定的 JSON 格式返回结果。
注意: 只修改与当前任务相关的文件，不要重复创建已有文件。`;

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
