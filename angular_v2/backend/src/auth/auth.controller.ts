import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { LoginRequestDto } from './login-request.dto.js';
import { LoginResponseDto } from './login-response.dto.js';
import { LogoutRequestDto } from './logout-request.dto.js';
import { MeResponseDto } from './me-response.dto.js';
import { Public } from './public.decorator.js';
import { RefreshRequestDto } from './refresh-request.dto.js';
import { RefreshResponseDto } from './refresh-response.dto.js';
import type { AccessTokenPayload } from './jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body() dto: LoginRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<LoginResponseDto> {
    return this.authService.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshRequestDto): Promise<RefreshResponseDto> {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: LogoutRequestDto): Promise<void> {
    return this.authService.logout(dto);
  }

  @Get('me')
  me(@Req() req: FastifyRequest & { user?: AccessTokenPayload }): MeResponseDto {
    const user = req.user;
    if (user === undefined) {
      throw new UnauthorizedException('unauthorized');
    }
    return {
      sub: user.sub,
      role: user.role,
      expiresIn: Math.max(0, user.exp - Math.floor(Date.now() / 1000)),
    };
  }
}
