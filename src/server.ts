import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { read_json, read_jsonl, append_jsonl } from "./lib/store.js";
import { load_tasks, update_task } from "./core/splitter.js";
import { load_workers, update_worker } from "./core/worker.js";
import { alert_info, alert_error, on_alert, type Alert } from "./lib/alert.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import type { HookEvent } from "./types/event.js";
import type { ProgressSnapshot } from "./types/progress.js";

let http_server: ReturnType<typeof createServer> | null = null;
let ws_server: WebSocketServer | null = null;
const ws_clients = new Set<WebSocket>();

/** 启动 HTTP + WebSocket 服务器 */
export function start_server(port: number = 3456): void {
  if (http_server) {
    alert_info("服务器已在运行");
    return;
  }

  http_server = createServer(handle_request);

  ws_server = new WebSocketServer({ server: http_server, path: "/ws" });
  ws_server.on("connection", (ws) => {
    ws_clients.add(ws);
    alert_info(`WebSocket 客户端连接 (当前: ${ws_clients.size})`);

    // 发送当前状态
    send_ws(ws, { type: "init", tasks: load_tasks(), workers: load_workers() });

    ws.on("close", () => {
      ws_clients.delete(ws);
    });
    ws.on("error", () => ws_clients.delete(ws));
  });

  // 注册告警处理器 → 推送 WebSocket
  on_alert((alert: Alert) => {
    broadcast_ws({ type: "alert", ...alert });
  });

  http_server.listen(port, () => {
    alert_info(`🌐 服务器启动: http://localhost:${port}`);
    alert_info(`📡 WebSocket: ws://localhost:${port}/ws`);
  });
}

/** 停止服务器 */
export function stop_server(): void {
  for (const ws of ws_clients) {
    ws.close();
  }
  ws_clients.clear();
  if (http_server) {
    http_server.close();
    http_server = null;
  }
  ws_server = null;
}

/** HTTP 请求处理 */
function handle_request(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const method = req.method || "GET";

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 路由
  try {
    if (url.pathname === "/api/tasks" && method === "GET") {
      return json_response(res, 200, load_tasks());
    }

    if (url.pathname === "/api/workers" && method === "GET") {
      return json_response(res, 200, load_workers());
    }

    if (url.pathname === "/api/progress" && method === "GET") {
      return json_response(res, 200, read_json<ProgressSnapshot>("progress.json", {} as ProgressSnapshot));
    }

    if (url.pathname === "/api/events" && method === "GET") {
      const task_id = url.searchParams.get("taskId");
      const events = read_jsonl<HookEvent>("events.jsonl");
      const filtered = task_id ? events.filter((e) => e.task_id === task_id) : events;
      return json_response(res, 200, filtered);
    }

    // Hooks 接收端点
    if (url.pathname === "/api/hooks" && method === "POST") {
      return handle_hooks(req, res);
    }

    // 重试任务
    const retry_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/retry$/);
    if (retry_match && method === "POST") {
      const task_id = retry_match[1];
      const task = update_task(task_id, { status: "todo", error_count: 0, last_error: null, retry_count: 0 });
      if (!task) return json_response(res, 404, { error: "任务不存在" });
      broadcast_ws({ type: "task_update", task });
      return json_response(res, 200, task);
    }

    // 停止任务
    const stop_match = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (stop_match && method === "DELETE") {
      const task_id = stop_match[1];
      const task = update_task(task_id, { status: "skipped" });
      if (!task) return json_response(res, 404, { error: "任务不存在" });
      broadcast_ws({ type: "task_update", task });
      return json_response(res, 200, task);
    }

    // 首页（简单的状态面板）
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return html_response(res, render_dashboard());
    }

    json_response(res, 404, { error: "Not Found" });
  } catch (e) {
    alert_error("HTTP 请求处理错误", { error: (e as Error).message, path: url.pathname });
    json_response(res, 500, { error: (e as Error).message });
  }
}

/** 处理 Hooks 事件 */
function handle_hooks(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const event: HookEvent = JSON.parse(body);
      event.timestamp = event.timestamp || new Date().toISOString();

      // 写入事件日志
      append_jsonl("events.jsonl", event);

      // 更新关联任务状态
      if (event.event === "stop" && event.task_id) {
        update_task(event.task_id, {
          status: "done",
          completed_at: new Date().toISOString(),
        });
        // 释放 worker
        if (event.worker_id) {
          update_worker(event.worker_id, { status: "idle", current_task: null });
        }
        alert_info(`✅ 任务 ${event.task_id} 完成 (via Hooks)`);
      }

      // 推送 WebSocket
      broadcast_ws({ type: "event", data: event });

      json_response(res, 200, { ok: true });
    } catch (e) {
      json_response(res, 400, { error: "无效的 JSON" });
    }
  });
}

/** JSON 响应 */
function json_response(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

/** HTML 响应 */
function html_response(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** WebSocket 广播 */
function broadcast_ws(data: unknown): void {
  const msg = JSON.stringify(data);
  for (const ws of ws_clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/** 发送单个客户端 */
function send_ws(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/** 推送进度更新（供外部调用） */
export function push_progress_update(): void {
  const tasks = load_tasks();
  const workers = load_workers();
  broadcast_ws({ type: "progress", tasks, workers });
}


/** 渲染 Dashboard */
function render_dashboard(): string {
  return DASHBOARD_HTML;
}
