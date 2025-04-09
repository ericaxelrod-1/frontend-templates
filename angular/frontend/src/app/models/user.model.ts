import { Group, Permission as GroupPermission } from './group.model';

export interface Permission {
  id: string;
  name: string;
  description: string;
  resourceName: string;
  actionName: string;
}

export interface UserPreferences {
  sidebarCollapsed?: boolean;
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  notifications?: {
    email?: boolean;
    push?: boolean;
    desktop?: boolean;
  };
}

export interface User {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  isVerified?: boolean;
  lastLogin?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  permissions: Permission[];
  /**
   * @deprecated Use permissions instead
   */
  roles?: string[];
  emailVerified?: boolean;
  requiresPasswordChange?: boolean;
  lastPasswordChange?: Date;
  groups?: Partial<Group>[];
  preferences?: UserPreferences;
}

export interface UserLogin {
  email: string;
  password: string;
  recaptchaToken?: string;
}

export interface UserRegistration {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  privacyConsent?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  csrfToken: string;
  expiresIn: number;
  requiresVerification?: boolean;
  debugInfo?: {
    verificationToken?: string;
    emailSent?: boolean;
    emailSender?: string;
    emailSubject?: string;
    sent?: string;
    [key: string]: any;
  };
}

export interface VerificationResponse {
  user: User;
  success: boolean;
  message: string;
  accessToken?: string;
  refreshToken?: string;
  csrfToken?: string;
  expiresIn?: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  passwordConfirmation: string;
}

export interface AdminUserCreation {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  /**
   * @deprecated Use permissions instead. Roles are being phased out in favor of permissions.
   */
  roles?: string[];
  permissions?: {
    id: string;
    resource: string;
    action: string;
    granted: boolean;
  }[];
  groups?: number[];
  requiresPasswordChange: boolean;
}

export interface PasswordChangeRequest {
  currentPassword?: string;
  newPassword: string;
  confirmPassword: string;
} 