import { User } from './user.model';

export interface Group {
  id: number;
  name: string;
  description?: string;
  owner: User | number;
  members?: GroupMember[];
}

export interface GroupMember {
  id: number;
  user: User | number;
  group: Group | number;
  role: 'admin' | 'member' | 'viewer';
  joinedAt: Date;
} 