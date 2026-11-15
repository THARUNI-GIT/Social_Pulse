import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Ctx, HeaderAuthGuard, Me } from '../common/header-auth';
import { parseLimit } from '../common/pagination';
import { ConversationsService } from './conversations.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../redis/presence.service';

const pg = (q: any) => ({ cursor: q?.cursor, limit: parseLimit(q?.limit) });

class CreateGroupDto {
  @ApiProperty({ example: 'Trip planning' }) @IsString() @Length(1, 60) name: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(49) @IsUUID('all', { each: true }) memberIds: string[];
}
class AddMembersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(49) @IsUUID('all', { each: true }) memberIds: string[];
}
class RenameDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) name?: string; }

@ApiTags('conversations')
@ApiHeader({ name: 'x-user-id' })
@Controller('conversations')
@UseGuards(HeaderAuthGuard)
export class ConversationsController {
  constructor(
    private readonly convs: ConversationsService,
    private readonly msgs: MessagesService,
    private readonly presence: PresenceService
  ) {}

  @Post('direct/:otherUserId')
  @HttpCode(200)
  createDirect(@Me() m: Ctx, @Param('otherUserId') otherUserId: string) {
    return this.convs.findOrCreateDirect(m.userId, otherUserId);
  }

  @Post('group')
  @HttpCode(201)
  createGroup(@Me() m: Ctx, @Body() dto: CreateGroupDto) {
    return this.convs.createGroup(m.userId, dto.name, dto.memberIds);
  }

  @Get()
  list(@Me() m: Ctx) {
    return this.convs.list(m.userId);
  }

  /** Badge data for the chat navigation: total unread plus a per-conversation breakdown. */
  @Get('unread')
  unread(@Me() m: Ctx) {
    return this.msgs.unread(m.userId);
  }

  /**
   * Online/last-seen snapshot for people I actually share a conversation with. Without this the UI
   * could only ever show the value present at page load, so everyone looked offline.
   */
  @Get('presence')
  async presenceSnapshot(@Me() m: Ctx, @Query('userIds') raw?: string) {
    const requested = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const allowed = await this.convs.sharedWith(m.userId, requested);
    return { items: await this.presence.snapshot(allowed) };
  }

  /** Opening (or viewing) a conversation acknowledges everything unread in it, once. */
  @Post(':id/read')
  @HttpCode(200)
  async markRead(@Me() m: Ctx, @Param('id') id: string) {
    const r = await this.msgs.markConversationRead(m.userId, id);
    // Push the same numbers to every tab of this user so none keeps a stale badge.
    this.convs.rooms.emitToUser(m.userId, 'conversation:unread', { total: r.total, byConversation: r.byConversation });
    return r;
  }

  @Get(':id')
  get(@Me() m: Ctx, @Param('id') id: string) {
    return this.convs.getForUser(id, m.userId);
  }

  @Get(':id/members')
  members(@Me() m: Ctx, @Param('id') id: string) {
    return this.convs.members(id, m.userId);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(@Me() m: Ctx, @Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.convs.addMembers(m.userId, id, dto.memberIds);
  }

  @Delete(':id/members/:userId')
  removeMember(@Me() m: Ctx, @Param('id') id: string, @Param('userId') userId: string) {
    return this.convs.removeMember(m.userId, id, userId);
  }

  /** Promote a member to admin (admins only). */
  @Post(':id/members/:userId/admin')
  @HttpCode(200)
  promote(@Me() m: Ctx, @Param('id') id: string, @Param('userId') userId: string) {
    return this.convs.promote(m.userId, id, userId);
  }

  @Patch(':id')
  rename(@Me() m: Ctx, @Param('id') id: string, @Body() dto: RenameDto) {
    return this.convs.rename(m.userId, id, dto.name);
  }

  @Get(':id/messages')
  listMessages(@Me() m: Ctx, @Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.msgs.list(id, m.userId, pg({ cursor, limit }));
  }
}
