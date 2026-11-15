import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Actor, AdminOnly, UserGuard } from './auth';
import { ModerationService } from './moderation.service';
import { REASONS } from './rules';
class ReportDto { @ApiProperty({ enum: REASONS }) @IsIn(REASONS as unknown as string[]) reason: string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) details?: string; }
class ResolveDto { @ApiProperty({ enum: ['remove', 'dismiss'] }) @IsIn(['remove', 'dismiss']) action: 'remove' | 'dismiss'; }
const lim = (v: unknown) => Math.min(Math.max(parseInt(String(v ?? 20), 10) || 20, 1), 100);
@ApiTags('moderation') @ApiHeader({ name: 'x-user-id' }) @Controller()
export class ModerationController {
  constructor(private m: ModerationService) {}
  @Post('posts/:id/report') @HttpCode(201) @UseGuards(UserGuard) reportPost(@Actor() u: any, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReportDto) { return this.m.reportPost(u.userId, id, d.reason, d.details); }
  @Post('posts/:postId/comments/:id/report') @HttpCode(201) @UseGuards(UserGuard) reportComment(@Actor() u: any, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReportDto) { return this.m.reportComment(u.userId, id, d.reason, d.details); }
  @Get('admin/reports') @UseGuards(AdminOnly) list(@Query('status') status = 'open', @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.m.list(status, lim(limit), cursor); }
  @Get('admin/reports/stats') @UseGuards(AdminOnly) stats() { return this.m.stats(); }
  // Admin review of a reported post: bypasses feed visibility and the soft delete, so removed
  // content stays inspectable (and restorable) from the reports history.
  @Get('admin/posts/:id') @UseGuards(AdminOnly) adminPost(@Param('id', ParseUUIDPipe) id: string) { return this.m.adminPost(id); }
  @Post('admin/posts/:id/restore') @HttpCode(200) @UseGuards(AdminOnly) restorePost(@Actor() a: any, @Param('id', ParseUUIDPipe) id: string) { return this.m.restorePost(a.userId, id); }
  @Get('admin/comments/:id') @UseGuards(AdminOnly) adminComment(@Param('id', ParseUUIDPipe) id: string) { return this.m.adminComment(id); }
  @Post('admin/comments/:id/restore') @HttpCode(200) @UseGuards(AdminOnly) restoreComment(@Actor() a: any, @Param('id', ParseUUIDPipe) id: string) { return this.m.restoreComment(a.userId, id); }
  @Post('admin/reports/:id/resolve') @HttpCode(200) @UseGuards(AdminOnly) resolve(@Actor() a: any, @Param('id', ParseUUIDPipe) id: string, @Body() d: ResolveDto) { return this.m.resolve(a.userId, id, d.action); }
}
