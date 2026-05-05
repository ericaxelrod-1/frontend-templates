import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PrivacyCaptchaService {
  private captchaTokenSource = new BehaviorSubject<string | null>(null);
  captchaToken$ = this.captchaTokenSource.asObservable();

  setToken(token: string | null) {
    this.captchaTokenSource.next(token);
  }

  getToken(): string | null {
    return this.captchaTokenSource.getValue();
  }

  reset() {
    this.captchaTokenSource.next(null);
  }
}
