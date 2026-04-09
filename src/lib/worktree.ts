import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const WORKTREES_DIR = "worktrees";

/** 确保 worktrees 目录存在 */
function ensure_dir(base: string): void {
  const dir = join(base, WORKTREES_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 获取 worktree 路径 */
export function worktree_path(base: string, worker_id: string): string {
  return join(base, WORKTREES_DIR, worker_id);
}

/**
 * 为 worker 创建独立的 Git worktree
 * @param project_dir 项目根目录
 * @param worker_id worker 标识
 * @param branch_name 分支名（默认 auto-generated）
 * @returns worktree 绝对路径
 */
export function create_worktree(
  project_dir: string,
  worker_id: string,
  branch_name?: string
): string {
  ensure_dir(project_dir);
  const wt_path = worktree_path(project_dir, worker_id);
  const branch = branch_name || `agent-king/${worker_id}`;

  // 如果已存在，先清理
  if (existsSync(wt_path)) {
    remove_worktree(project_dir, worker_id);
  }

  try {
    // 检查是否是 git 仓库
    execSync(`git -C ${project_dir} rev-parse --git-dir`, { stdio: "ignore" });
  } catch {
    // 不是 git 仓库，初始化一个
    execSync(`git -C ${project_dir} init`, { stdio: "ignore" });
    execSync(`git -C ${project_dir} add -A`, { stdio: "ignore" });
    try {
      execSync(`git -C ${project_dir} commit -m "agent-king: initial commit"`, {
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "agent-king",
          GIT_AUTHOR_EMAIL: "agent-king@local",
          GIT_COMMITTER_NAME: "agent-king",
          GIT_COMMITTER_EMAIL: "agent-king@local",
        },
      });
    } catch {
      // 可能没有文件要提交
    }
  }

  try {
    // 创建 worktree
    execSync(
      `git -C ${project_dir} worktree add -b ${branch} ${wt_path}`,
      { stdio: "ignore" }
    );
    return wt_path;
  } catch {
    // 分支可能已存在，尝试用现有分支
    try {
      execSync(
        `git -C ${project_dir} worktree add ${wt_path} ${branch}`,
        { stdio: "ignore" }
      );
      return wt_path;
    } catch {
      // 兜底：直接用主分支
      execSync(
        `git -C ${project_dir} worktree add ${wt_path}`,
        { stdio: "ignore" }
      );
      return wt_path;
    }
  }
}

/** 移除 worktree */
export function remove_worktree(project_dir: string, worker_id: string): void {
  const wt_path = worktree_path(project_dir, worker_id);
  try {
    execSync(`git -C ${project_dir} worktree remove --force ${wt_path}`, {
      stdio: "ignore",
    });
  } catch {
    // 手动清理
    try {
      if (existsSync(wt_path)) rmSync(wt_path, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/** 列出所有 worktree */
export function list_worktrees(project_dir: string): string[] {
  try {
    const out = execSync(`git -C ${project_dir} worktree list --porcelain`, {
      encoding: "utf-8",
    });
    const paths: string[] = [];
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice(9).trim());
      }
    }
    return paths;
  } catch {
    return [];
  }
}

/** 清理所有 agent-king worktree */
export function cleanup_all(project_dir: string): void {
  const wts = list_worktrees(project_dir);
  for (const wt of wts) {
    if (wt.includes(WORKTREES_DIR)) {
      try {
        execSync(`git -C ${project_dir} worktree remove --force ${wt}`, {
          stdio: "ignore",
        });
      } catch {
        try { rmSync(wt, { recursive: true, force: true }); } catch {}
      }
    }
  }
  // 清理 worktrees 目录
  const dir = join(project_dir, WORKTREES_DIR);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
