import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { loginDto, verifyOtpDto, type SessionUser } from '@mom/shared';
import { AuthService, type IssuedSession } from './auth.service.js';
import { ACCESS_COOKIE, JwtAuthGuard, REFRESH_COOKIE } from './jwt-auth.guard.js';
import { Public } from './public.decorator.js';
import { CurrentUser, type AuthUser } from './auth-user.js';
import { parseDuration } from './tokens.service.js';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() body: unknown, @Req() req: Request) {
    const { email, password } = loginDto.parse(body);
    return this.auth.login(email, password, req.ip);
  }

  @Public()
  @Post('verify-otp')
  async verifyOtp(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { challengeId, otp } = verifyOtpDto.parse(body);
    const issued = await this.auth.verifyOtp(challengeId, otp, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setCookies(res, issued);
    return issued.user;
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[
      REFRESH_COOKIE
    ];
    const issued = await this.auth.refresh(token ?? '', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setCookies(res, issued);
    return issued.user;
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[
      REFRESH_COOKIE
    ];
    await this.auth.logout(token);
    res.clearCookie(ACCESS_COOKIE, this.cookieBase());
    res.clearCookie(REFRESH_COOKIE, this.cookieBase());
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.sessionUser(user.id);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.auth.revokeSession(user.id, id);
    return { ok: true };
  }

  // ── cookies ──────────────────────────────────────────────────────────

  private cookieBase(): CookieOptions {
    return {
      httpOnly: true,
      // Strict, not Lax: nothing in this application is reached by following a
      // link from elsewhere, so there is no flow that Strict would break.
      sameSite: 'strict',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/',
    };
  }

  private setCookies(res: Response, issued: IssuedSession): void {
    const accessTtl = parseDuration(this.config.get<string>('ACCESS_TOKEN_TTL') ?? '15m');
    res.cookie(ACCESS_COOKIE, issued.accessToken, {
      ...this.cookieBase(),
      maxAge: accessTtl,
    });
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieBase(),
      expires: issued.refreshExpiresAt,
    });
  }
}
