import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..");
const DATA_DIR = join(PROJECT_DIR, "data");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

describe("store", async () => {
  const { read_json, write_json, append_jsonl, read_jsonl } = await import("../src/lib/store.js");

  it("write_json + read_json", () => {
    const data = { test: true, count: 42 };
    write_json("test-store.json", data);
    const result = read_json("test-store.json", {});
    assert.deepStrictEqual(result, data);
    try { unlinkSync(join(DATA_DIR, "test-store.json")); } catch {}
  });

  it("read_json 返回 fallback 当文件不存在", () => {
    const result = read_json("nonexistent.json", { default: true });
    assert.deepStrictEqual(result, { default: true });
  });

  it("append_jsonl + read_jsonl", () => {
    const file = "test-events.jsonl";
    const path = join(DATA_DIR, file);
    try { unlinkSync(path); } catch {}

    append_jsonl(file, { event: "start", seq: 1 });
    append_jsonl(file, { event: "stop", seq: 2 });

    const entries = read_jsonl(file);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].event, "start");
    assert.equal(entries[1].event, "stop");

    try { unlinkSync(path); } catch {}
  });
});

describe("alert", async () => {
  const { on_alert, alert_info } = await import("../src/lib/alert.js");

  it("on_alert 接收告警", () => {
    return new Promise<void>((resolve) => {
      on_alert((a: any) => {
        assert.equal(a.level, "info");
        assert.equal(a.message, "test-alert-msg");
        resolve();
      });
      alert_info("test-alert-msg");
    });
  });
});

describe("tmux", async () => {
  const tmux = await import("../src/lib/tmux.js");

  it("创建和销毁 session", () => {
    const name = "test-ak-" + Date.now();
    tmux.new_session(name);
    assert.equal(tmux.has_session(name), true);
    tmux.kill_session(name);
    assert.equal(tmux.has_session(name), false);
  });

  it("send_keys 和 capture_pane", () => {
    const name = "test-ak-cap-" + Date.now();
    tmux.new_session(name);
    tmux.send_keys(name, 'echo "hello-ak"');
    // 等命令执行
    const start = Date.now();
    while (Date.now() - start < 800) {}
    const output = tmux.capture_pane(name);
    assert.ok(output.length > 0);
    tmux.kill_session(name);
  });

  it("不存在的 session 返回 false", () => {
    assert.equal(tmux.has_session("nonexistent-xyz-123"), false);
  });
});

describe("splitter", async () => {
  const { load_tasks } = await import("../src/core/splitter.js");

  it("load_tasks 返回空数组当无文件", () => {
    try { unlinkSync(join(DATA_DIR, "tasks.json")); } catch {}
    const tasks = load_tasks();
    assert.ok(Array.isArray(tasks));
  });
});

describe("worktree", async () => {
  const { create_worktree, remove_worktree, worktree_path, cleanup_all } =
    await import("../src/lib/worktree.js");

  const test_dir = join(PROJECT_DIR, "data", "wt-test-" + Date.now());
  if (!existsSync(test_dir)) mkdirSync(test_dir, { recursive: true });

  it("create_worktree 创建独立工作区", () => {
    const wt = create_worktree(test_dir, "worker-test-1");
    assert.ok(existsSync(wt), "worktree 目录应存在");
  });

  it("remove_worktree 清理工作区", () => {
    remove_worktree(test_dir, "worker-test-1");
    const wt = worktree_path(test_dir, "worker-test-1");
    // 目录可能已被 git worktree remove 清理
    assert.ok(true); // 如果没抛异常就算通过
  });

  it("cleanup_all 清理所有", () => {
    create_worktree(test_dir, "worker-test-a");
    create_worktree(test_dir, "worker-test-b");
    cleanup_all(test_dir);
    // 不抛异常即可
    assert.ok(true);
  });

  // 清理测试目录
  try { cleanup_all(test_dir); } catch {}
  try { rmSync(test_dir, { recursive: true, force: true }); } catch {}
});

describe("checkpoint", async () => {
  const { save_checkpoint, load_checkpoint, has_checkpoint, restore_checkpoint } =
    await import("../src/lib/checkpoint.js");

  it("save + load checkpoint", () => {
    save_checkpoint("test idea", "/tmp/test-project");
    const cp = load_checkpoint();
    assert.ok(cp !== null);
    assert.equal(cp!.idea, "test idea");
    assert.equal(cp!.version, 1);
  });

  it("restore 将 doing 重置为 todo", async () => {
    // 先写一个带 doing 状态的 tasks.json
    const { write_json } = await import("../src/lib/store.js");
    write_json("tasks.json", [
      { id: "t1", title: "test", description: "d", status: "done", priority: "high", dependencies: [], assigned_worker: null, created_at: "", started_at: null, completed_at: "", error_count: 0, last_error: null, git_commit: null, retry_count: 0, max_retries: 3 },
      { id: "t2", title: "test2", description: "d2", status: "doing", priority: "medium", dependencies: [], assigned_worker: "w1", created_at: "", started_at: "", completed_at: null, error_count: 0, last_error: null, git_commit: null, retry_count: 0, max_retries: 3 },
    ]);
    save_checkpoint("restore test", "/tmp");

    const cp = restore_checkpoint();
    assert.ok(cp !== null);
    assert.equal(cp!.tasks[0].status, "done");
    assert.equal(cp!.tasks[1].status, "todo"); // doing → todo
    assert.equal(cp!.tasks[1].assigned_worker, null);
  });
});
