import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CaptchaResult {
  token: string;
  challenge: string;
  type: string;
}

interface CaptchaResponse {
  token: string;
  challenge: string;
  type: string;
}

@Injectable({
  providedIn: 'root'
})
export class CaptchaService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Generate a new CAPTCHA
   * @returns Observable with captcha token, challenge and type
   */
  generateCaptcha(): Observable<CaptchaResponse> {
    return this.http.get<CaptchaResponse>(`${this.apiUrl}/captcha/generate`);
  }
} 