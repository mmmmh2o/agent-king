import { execSync, spawn } from "child_process";

export interface TmuxSessionInfo {
  name: string;
  alive: boolean;
  pid: number | null;
}

/** 检查 session 是否存在 */
export function has_session(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 创建后台 session */
export function new_session(name: string, cwd?: string): void {
  const cmd = cwd
    ? `tmux new-session -d -s ${name} -c ${cwd}`
    : `tmux new-session -d -s ${name}`;
  execSync(cmd, { stdio: "ignore" });
}

/** 发送按键 */
export function send_keys(session: string, keys: string, enter = true): void {
  const escaped = keys.replace(/'/g, "'\\''");
  const cmd = enter
    ? `tmux send-keys -t ${session} '${escaped}' Enter`
    : `tmux send-keys -t ${session} '${escaped}'`;
  execSync(cmd, { stdio: "ignore" });
}

/** 抓取 pane 内容 */
export function capture_pane(session: string, lines?: number): string {
  const flag = lines ? `-S -${lines}` : "-p";
  return execSync(`tmux capture-pane -t ${session} ${flag}`, {
    encoding: "utf-8",
  });
}

/** 杀掉 session */
export function kill_session(name: string): void {
  try {
    execSync(`tmux kill-session -t ${name}`, { stdio: "ignore" });
  } catch {
    // session 可能已经不存在
  }
}

/** 列出所有 session */
export function list_sessions(): string[] {
  try {
    const out = execSync(`tmux list-sessions -F '#{session_name}'`, {
      encoding: "utf-8",
    });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** 获取 session 信息 */
export function session_info(name: string): TmuxSessionInfo {
  const alive = has_session(name);
  let pid: number | null = null;
  if (alive) {
    try {
      const out = execSync(
        `tmux list-panes -t ${name} -F '#{pane_pid}'`,
        { encoding: "utf-8" }
      );
      pid = parseInt(out.trim().split("\n")[0], 10);
    } catch {
      // ignore
    }
  }
  return { name, alive, pid };
}
