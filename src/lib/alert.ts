export type AlertLevel = "error" | "warn" | "info";

export interface Alert {
  level: AlertLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

const alert_handlers: Array<(alert: Alert) => void> = [];

/** 注册告警处理器 */
export function on_alert(handler: (alert: Alert) => void): void {
  alert_handlers.push(handler);
}

/** 发送告警 */
export function alert(level: AlertLevel, message: string, context?: Record<string, unknown>): void {
  const a: Alert = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  };

  // 终端输出
  const prefix = level === "error" ? "🔴" : level === "warn" ? "🟡" : "🟢";
  console.error(`${prefix} [${level.toUpperCase()}] ${message}`);

  // 通知所有处理器
  for (const handler of alert_handlers) {
    try {
      handler(a);
    } catch {
      // handler 出错不影响其他
    }
  }
}

export const alert_error = (msg: string, ctx?: Record<string, unknown>) => alert("error", msg, ctx);
export const alert_warn = (msg: string, ctx?: Record<string, unknown>) => alert("warn", msg, ctx);
export const alert_info = (msg: string, ctx?: Record<string, unknown>) => alert("info", msg, ctx);
