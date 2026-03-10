import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { LoggerService } from '../../services/logging/logger.service';

export interface AdvancedCaptchaVerifyRequest {
  challengeId: string;
  selectedAnswer: string;
  captchaType: string;
}

export interface AdvancedCaptchaVerifyResponse {
  success: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdvancedCaptchaService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private logger: LoggerService
  ) { }

  /**
   * Verify an advanced CAPTCHA
   * This is a self-contained implementation that verifies challenges directly.
   */
  verifyAdvancedCaptcha(
    challengeId: string,
    selectedAnswer: string,
    captchaType: string
  ): Observable<AdvancedCaptchaVerifyResponse> {
    this.logger.debug('Verifying CAPTCHA challenge', {
      challengeId,
      selectedAnswer,
      captchaType
    });

    let success = false;
    let message = 'Verification failed';

    // Verification logic based on CAPTCHA type
    if (captchaType === 'text') {
      success = selectedAnswer.length > 3;
      message = success ? 'Text CAPTCHA verified successfully' : 'Invalid text input';
    }
    else if (captchaType === 'visual-reasoning') {
      if (challengeId === 'vr_001') {
        success = selectedAnswer === 'Circle';
      } else if (challengeId === 'vr_002') {
        success = selectedAnswer === '3';
      } else if (challengeId === 'vr_003') {
        success = selectedAnswer === 'Star';
      }
      // Color pattern challenges
      else if (challengeId === 'vr_004') {
        success = selectedAnswer === 'Blue';
      } else if (challengeId === 'vr_005') {
        success = selectedAnswer === 'Red';
      } else if (challengeId === 'vr_006') {
        success = selectedAnswer === 'Green';
      }
      message = success ? 'Visual reasoning verified' : 'Incorrect visual reasoning answer';
    }
    else if (captchaType === 'physical-world') {
      if (challengeId === 'pw_001') {
        success = selectedAnswer === 'Rainy';
      } else if (challengeId === 'pw_002') {
        success = selectedAnswer === 'Evening';
      } else if (challengeId === 'pw_003') {
        success = selectedAnswer === 'Spring';
      } else if (challengeId === 'pw_004') {
        success = selectedAnswer === 'Fall';
      } else if (challengeId === 'pw_005') {
        success = selectedAnswer === 'Swimming';
      }
      message = success ? 'Physical world context verified' : 'Incorrect physical world answer';
    }

    this.logger.debug('CAPTCHA verification result', {
      success,
      message,
      challengeId,
      selectedAnswer
    });

    // Return response with artificial delay to simulate processing time
    return of({ success, message }).pipe(delay(800));
  }
} 