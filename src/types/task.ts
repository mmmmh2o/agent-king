export type TaskStatus = "todo" | "doing" | "done" | "error" | "skipped";
export type Priority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dependencies: string[];
  assigned_worker: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_count: number;
  last_error: string | null;
  git_commit: string | null;
  retry_count: number;
  max_retries: number;
}

export interface TaskInput {
  title: string;
  description: string;
  priority?: Priority;
  dependencies?: string[];
}
