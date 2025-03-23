export interface User {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  roles?: string[];
}

export interface UserLogin {
  email: string;
  password: string;
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