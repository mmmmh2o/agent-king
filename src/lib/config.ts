import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

export interface AgentKingConfig {
  /** LLM API 配置 */
  llm: {
    api_key: string;
    base_url?: string;
    model?: string;
  };
  /** Worker 配置 */
  worker?: {
    model?: string;
    count?: number;
  };
  /** Web 面板配置 */
  server?: {
    port?: number;
  };
  /** 项目目录 */
  project_dir?: string;
}

const CONFIG_FILENAMES = [
  "agent-king.json",
  ".agent-king.json",
];

const GLOBAL_CONFIG_DIR = join(homedir(), ".agent-king");
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

let _cached: AgentKingConfig | null = null;

/** 读取配置文件，按优先级查找 */
function find_config(project_dir?: string): string | null {
  // 1. 项目目录下的配置
  if (project_dir) {
    for (const name of CONFIG_FILENAMES) {
      const p = join(project_dir, name);
      if (existsSync(p)) return p;
    }
  }
  // 2. 当前工作目录
  for (const name of CONFIG_FILENAMES) {
    const p = join(process.cwd(), name);
    if (existsSync(p)) return p;
  }
  // 3. 全局配置 ~/.agent-king/config.json
  if (existsSync(GLOBAL_CONFIG_PATH)) return GLOBAL_CONFIG_PATH;
  return null;
}

/** 加载配置 */
export function load_config(project_dir?: string): AgentKingConfig {
  if (_cached) return _cached;

  const config_path = find_config(project_dir);

  // 从文件读取
  let file_config: Partial<AgentKingConfig> = {};
  if (config_path) {
    try {
      const raw = readFileSync(config_path, "utf-8");
      file_config = JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️  配置文件解析失败 (${config_path}): ${(e as Error).message}`);
    }
  }

  // 合并: 文件配置 > 环境变量 > 默认值
  _cached = {
    llm: {
      api_key: file_config.llm?.api_key || process.env.OPENAI_API_KEY || "",
      base_url: file_config.llm?.base_url || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: file_config.llm?.model || process.env.LLM_MODEL || "gpt-4o-mini",
    },
    worker: {
      model: file_config.worker?.model || process.env.WORKER_MODEL || "claude",
      count: file_config.worker?.count || 3,
    },
    server: {
      port: file_config.server?.port || parseInt(process.env.AGENT_KING_PORT || "3456", 10),
    },
    project_dir: file_config.project_dir,
  };

  return _cached;
}

/** 获取配置（快捷方法） */
export function get_config(): AgentKingConfig {
  return load_config();
}

/** 清除缓存（测试用） */
export function reset_config(): void {
  _cached = null;
}

/** 打印配置来源（调试用） */
export function show_config_source(): void {
  const config_path = find_config();
  if (config_path) {
    console.log(`📁 配置文件: ${config_path}`);
  } else {
    console.log("⚠️  未找到配置文件，使用环境变量 + 默认值");
    console.log(`   创建配置: ${GLOBAL_CONFIG_PATH}`);
  }
}
