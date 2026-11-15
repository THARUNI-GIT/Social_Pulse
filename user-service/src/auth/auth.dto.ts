import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : value));
export class RegisterDto {
  @ApiProperty() @Transform(({ value }) => String(value ?? '').trim().toLowerCase()) @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiProperty({ example: 'jane_doe' }) @lower() @Matches(/^[a-z0-9_]{3,20}$/, { message: 'handle must be 3-20 chars: a-z, 0-9, _' }) handle: string;
  @ApiProperty() @IsString() @Length(1, 50) displayName: string;
}
export class LoginDto { @ApiProperty({ description: 'email or handle' }) @lower() @IsString() @Length(1, 254) identifier: string; @ApiProperty() @IsString() @Length(1, 128) password: string; }
export class RefreshDto { @ApiProperty() @IsString() @Length(20, 200) refreshToken: string; }
/** Email verification link token (also used for reset). */
export class TokenDto { @ApiProperty() @IsString() @Length(16, 200) token: string; }
export class ForgotPasswordDto {
  @ApiProperty() @Transform(({ value }) => String(value ?? '').trim().toLowerCase()) @IsEmail() email: string;
}
/** Signed-in password change (does not use an email token). */
export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 128) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}
export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(16, 200) token: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password: string;
}
