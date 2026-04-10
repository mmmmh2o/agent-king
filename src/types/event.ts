export type HookEventType = "pre_tool_use" | "post_tool_use" | "stop" | "notification" | "start" | "error" | "done";

export interface HookEvent {
  task_id: string;
  worker_id: string;
  event: HookEventType;
  tool?: string;
  file?: string;
  success?: boolean;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface EventLogEntry extends HookEvent {
  seq: number;
}
