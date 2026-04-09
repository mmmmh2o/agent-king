export type WorkerStatus = "idle" | "busy" | "error" | "stopped";

export interface WorkerConfig {
  id: string;
  max_concurrent: number;
  model: string;
  tmux_session: string;
  status: WorkerStatus;
  current_task: string | null;
  started_at: string | null;
  last_heartbeat: string | null;
  error_count: number;
}
