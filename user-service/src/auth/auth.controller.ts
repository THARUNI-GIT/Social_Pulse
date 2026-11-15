import { Body, Controller, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, HeaderAuthGuard, Me } from '../common/header-auth';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, TokenDto } from './auth.dto';
@ApiTags('auth') @Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('register') register(@Body() d: RegisterDto) { return this.auth.register(d); }
  @Post('login') @HttpCode(200) login(@Body() d: LoginDto) { return this.auth.login(d); }
  @Post('refresh') @HttpCode(200) refresh(@Body() d: RefreshDto) { return this.auth.refresh(d.refreshToken); }
  @Post('logout') @HttpCode(200) logout(@Body() d: RefreshDto) { return this.auth.logout(d.refreshToken); }
  // ---- email verification (public: the emailed link carries a single-use token) ----
  @Post('verify-email') @HttpCode(200) verifyEmail(@Body() d: TokenDto) { return this.auth.verifyEmail(d.token); }
  @Post('resend-verification') @HttpCode(200) @UseGuards(HeaderAuthGuard) resend(@Me() m: Ctx) { return this.auth.resendVerification(m.userId); }
  // ---- password reset (public: reset tokens are single-use and expire) ----
  @Post('forgot-password') @HttpCode(200) forgot(@Body() d: ForgotPasswordDto) { return this.auth.requestPasswordReset(d); }
  @Post('reset-password') @HttpCode(200) reset(@Body() d: ResetPasswordDto) { return this.auth.resetPassword(d); }
  // Signed-in password change (the reset flow above is for a forgotten password).
  @Patch('password') @HttpCode(200) @UseGuards(HeaderAuthGuard) changePassword(@Me() m: Ctx, @Body() d: ChangePasswordDto) {
    return this.auth.changePassword(m.userId, d.currentPassword, d.newPassword);
  }
}
