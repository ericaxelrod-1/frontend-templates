import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CaptchaResult {
  captchaId: string;
  imageBase64: string;
  text?: string; // Only included in debug mode
}

export interface CaptchaVerifyRequest {
  captchaId: string;
  userInput: string;
}

export interface CaptchaVerifyResponse {
  success: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class CaptchaService {
  private readonly API_URL = `${environment.apiUrl}/captcha`;

  constructor(private http: HttpClient) {}

  /**
   * Generate a new CAPTCHA
   */
  generateCaptcha(debug: boolean = false): Observable<CaptchaResult> {
    const url = debug ? `${this.API_URL}/generate?debug=true` : `${this.API_URL}/generate`;
    return this.http.get<CaptchaResult>(url);
  }

  /**
   * Verify a CAPTCHA response
   */
  verifyCaptcha(captchaId: string, userInput: string): Observable<CaptchaVerifyResponse> {
    return this.http.post<CaptchaVerifyResponse>(`${this.API_URL}/verify`, {
      captchaId,
      userInput
    });
  }
} 