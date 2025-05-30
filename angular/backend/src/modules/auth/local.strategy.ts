import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from './auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(LocalStrategy.name);

  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'email',
    });
  }

  async validate(email: string, password: string): Promise<any> {
    try {
      this.logger.log(`Attempting to validate user: ${email}`);
      const user = await this.authService.validateUser(email, password);

      if (!user) {
        this.logger.warn(
          `Authentication failed for user: ${email} - Invalid credentials`,
        );
        throw new UnauthorizedException('Invalid email or password');
      }

      this.logger.log(`User ${email} authenticated successfully`);
      return user;
    } catch (error) {
      this.logger.error(`Authentication error for ${email}: ${error.message}`);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
