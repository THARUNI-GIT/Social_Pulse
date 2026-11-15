import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, IsUrl, Length, Max, Min, ValidateIf } from 'class-validator';
export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 280) bio?: string;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_o, v) => v !== null && v !== undefined) @IsUrl({ require_tld: false }) avatarUrl?: string | null;
}
export class PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
// A blank term is allowed on purpose: search is driven by a live-as-you-type box, so an empty or
// whitespace-only query must return an empty page rather than a 400.
export class SearchDto extends PageDto { @ApiProperty() @Transform(({ value }) => String(value ?? '').trim()) @IsString() @Length(0, 50) q: string; }
export class BatchDto { @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[]; }
/** Internal: chat-service asks whether two users block each other (not routed by the gateway). */
export class BlockCheckDto {
  @ApiProperty() @IsUUID('all') a: string;
  @ApiProperty() @IsUUID('all') b: string;
}
