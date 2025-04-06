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
  ) {}

  /**
   * Verify an advanced CAPTCHA
   * This is a mock implementation for development purposes.
   * In production, this would call a real API endpoint.
   */
  verifyAdvancedCaptcha(
    challengeId: string,
    selectedAnswer: string,
    captchaType: string
  ): Observable<AdvancedCaptchaVerifyResponse> {
    // In development, use mock data
    if (!environment.production) {
      this.logger.debug('Using mock CAPTCHA verification', {
        challengeId,
        selectedAnswer,
        captchaType
      });
      return this.mockVerifyCaptcha(challengeId, selectedAnswer, captchaType);
    }

    // In production, use real API
    const payload: AdvancedCaptchaVerifyRequest = {
      challengeId,
      selectedAnswer,
      captchaType
    };

    return this.http.post<AdvancedCaptchaVerifyResponse>(
      `${this.apiUrl}/captcha/advanced/verify`,
      payload
    );
  }

  /**
   * Mock verification for development purposes
   * This simulates a verification process with artificial delay
   */
  private mockVerifyCaptcha(
    challengeId: string,
    selectedAnswer: string,
    captchaType: string
  ): Observable<AdvancedCaptchaVerifyResponse> {
    let success = false;
    let message = 'Verification failed';

    // Simulate different verification logic based on CAPTCHA type
    if (captchaType === 'text') {
      // For text CAPTCHA, simulate a simple check
      success = selectedAnswer.length > 3;
      message = success ? 'Text CAPTCHA verified successfully' : 'Invalid text input';
    }
    else if (captchaType === 'visual-reasoning') {
      // For visual reasoning, check based on challenge ID
      if (challengeId === 'vr_001') {
        success = selectedAnswer === 'Circle';
      } else if (challengeId === 'vr_002') {
        success = selectedAnswer === '3';
      } else if (challengeId === 'vr_003') {
        success = selectedAnswer === 'Star';
      } 
      // Color pattern challenges
      else if (challengeId === 'vr_004') {
        // Red, Green, Blue, Red, Green... (next is Blue)
        success = selectedAnswer === 'Blue';
      } else if (challengeId === 'vr_005') {
        // Red, Yellow, Red, Yellow... (next is Red)
        success = selectedAnswer === 'Red';
      } else if (challengeId === 'vr_006') {
        // Red, Blue, Green, Red, Blue... (next is Green)
        success = selectedAnswer === 'Green';
      }
      message = success ? 'Visual reasoning verified' : 'Incorrect visual reasoning answer';
    }
    else if (captchaType === 'physical-world') {
      // For physical world understanding, check based on challenge ID
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

    // If environment is in debug mode, don't add randomness
    if (environment.debugMode) {
      // Keep the success value as determined above
      this.logger.debug('Debug mode - using exact matching for verification');
    } else {
      // Add some randomness to the verification for testing
      const randomSuccess = Math.random() > 0.3; // 70% success rate for testing
      success = randomSuccess;
      message = success ? 'CAPTCHA verified successfully' : 'CAPTCHA verification failed';
    }

    this.logger.debug('Mock CAPTCHA verification result', {
      success,
      message,
      challengeId,
      selectedAnswer
    });

    // Return response with artificial delay to simulate network request
    return of({ success, message }).pipe(delay(800));
  }
} 