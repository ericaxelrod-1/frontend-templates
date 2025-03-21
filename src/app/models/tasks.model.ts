import { Task } from './task.model';

export interface TasksState {
  tasks: Task[];
  selectedTask: Task | null;
  loading: boolean;
  error: string | null;
}

export interface TasksFilter {
  search?: string;
  assigneeId?: number;
  status?: string;
  categoryId?: number;
  tagId?: number;
  limit?: number;
  offset?: number;
}

export interface TaskCreateRequest {
  title: string;
  description?: string;
  assigneeId: number;
  dueDate?: string;
  status?: string;
  priority?: string;
  categoryId?: number;
  tagIds?: number[];
}

export interface TaskUpdateRequest {
  id: number;
  title?: string;
  description?: string;
  assigneeId?: number;
  dueDate?: string;
  status?: string;
  priority?: string;
  categoryId?: number;
  tagIds?: number[];
} 