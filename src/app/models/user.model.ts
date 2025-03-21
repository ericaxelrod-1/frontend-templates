export interface User {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  lastLogin?: Date;
  preferences?: UserPreferences;
}

export interface Role {
  id: number;
  name: string;
  permissions?: string[];
}

export interface UserPreferences {
  theme?: string;
  language?: string;
  notifications?: {
    email?: boolean;
    push?: boolean;
  };
} 