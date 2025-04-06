import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Exported for backwards compatibility
export interface CaptchaResult {
  captchaId: string;
  imageBase64: string;
}

interface CaptchaResponse {
  captchaId: string;
  imageBase64: string;
}

interface VerifyCaptchaRequest {
  captchaId: string;
  userInput: string;
}

interface VerifyCaptchaResponse {
  success: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class CaptchaService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Generate a new CAPTCHA
   * @returns Observable with captcha id and base64 image
   */
  generateCaptcha(): Observable<CaptchaResponse> {
    return this.http.get<CaptchaResponse>(`${this.apiUrl}/captcha/generate`);
  }

  /**
   * Verify a CAPTCHA
   * @param captchaId The CAPTCHA ID
   * @param userInput The user's input
   * @returns Observable with success status
   */
  verifyCaptcha(captchaId: string, userInput: string): Observable<VerifyCaptchaResponse> {
    const payload: VerifyCaptchaRequest = {
      captchaId,
      userInput
    };
    return this.http.post<VerifyCaptchaResponse>(`${this.apiUrl}/captcha/verify`, payload);
  }
} 