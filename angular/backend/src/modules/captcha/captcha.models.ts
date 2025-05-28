export interface CaptchaResult {
  captchaId: string;
  imageBase64: string;
  text?: string; // Only included for debugging
}

export interface CaptchaVerifyRequest {
  captchaId: string;
  userInput: string;
}

export interface CaptchaVerifyResponse {
  success: boolean;
  message: string;
}
