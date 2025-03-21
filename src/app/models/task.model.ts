import { User } from './user.model';

export interface Task {
  id: number;
  title: string;
  description?: string;
  assignee: User | number;
  dueDate?: Date | string;
  status: TaskStatus;
  priority?: TaskPriority;
  tags?: Tag[];
  category?: Category;
}

export type TaskStatus = 'Not Started' | 'In Progress' | 'Pending' | 'Completed';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export interface Tag {
  id: number;
  name: string;
  color?: string;
}

export interface Category {
  id: number;
  name: string;
  description?: string;
} 