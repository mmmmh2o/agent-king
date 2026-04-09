export interface ProgressSnapshot {
  idea: string;
  total_tasks: number;
  completed: number;
  in_progress: number;
  failed: number;
  skipped: number;
  started_at: string;
  updated_at: string;
  estimated_remaining: string;
  workers: WorkerProgress[];
}

export interface WorkerProgress {
  id: string;
  status: string;
  current_task: string | null;
  tasks_completed: number;
}
