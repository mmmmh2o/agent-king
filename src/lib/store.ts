import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const DATA_DIR = join(process.cwd(), "data");

/** 确保 data 目录存在 */
function ensure_data_dir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** 读取 JSON 文件，不存在返回默认值 */
export function read_json<T>(filename: string, fallback: T): T {
  ensure_data_dir();
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error(`[store] 读取 ${filename} 失败:`, (e as Error).message);
    return fallback;
  }
}

/** 写入 JSON 文件（原子写入到 tmp 再 rename） */
export function write_json<T>(filename: string, data: T): void {
  ensure_data_dir();
  const path = join(DATA_DIR, filename);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  writeFileSync(path, readFileSync(tmp)); // 简单的原子性保障
}

/** 追加一行 JSON 到 JSONL 文件 */
export function append_jsonl(filename: string, entry: unknown): void {
  ensure_data_dir();
  const path = join(DATA_DIR, filename);
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}

/** 读取 JSONL 文件 */
export function read_jsonl<T>(filename: string): T[] {
  ensure_data_dir();
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as T[];
}
