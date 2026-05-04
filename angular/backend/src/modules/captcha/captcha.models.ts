export interface CaptchaResult {
  token: string;
  challenge: string;
  type: string;
  text?: string; // Only included for debugging
}

export interface CaptchaVerifyRequest {
  captchaToken: string;
  captchaSolution: string;
}

export interface CaptchaVerifyResponse {
  success: boolean;
  message: string;
}
