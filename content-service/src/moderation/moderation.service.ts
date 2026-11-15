import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EventsService } from '../events/events.service';
import { decide, AdminAction } from './rules';
const nf = (m: string) => new NotFoundException({ code: 'NOT_FOUND', message: m });
@Injectable()
export class ModerationService {
  constructor(private db: PrismaService, private events: EventsService) {}

  private async file(reporterId: string, targetType: 'post' | 'comment', targetId: string, reason: string, details?: string) {
    let report: { id: string; status: any; createdAt: Date };
    try {
      report = await this.db.report.create({ data: { reporterId, targetType, targetId, reason, details } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException({ code: 'ALREADY_REPORTED', message: 'You already reported this' });
      throw e;
    }
    // Tell the moderation queue something arrived, otherwise an admin only finds out by manually
    // reloading /admin. notification-service fans this out to every admin account.
    await this.events.publish('report.created', {
      reportId: report.id,
      reporterId,
      targetType,
      targetId,
      reason,
      createdAt: report.createdAt,
    });
    return { id: report.id, status: report.status };
  }
  async reportPost(userId: string, postId: string, reason: string, details?: string) {
    if (!(await this.db.post.findFirst({ where: { id: postId, deletedAt: null }, select: { id: true } }))) throw nf('Post not found');
    return this.file(userId, 'post', postId, reason, details);
  }
  async reportComment(userId: string, commentId: string, reason: string, details?: string) {
    if (!(await this.db.comment.findFirst({ where: { id: commentId, deletedAt: null }, select: { id: true } }))) throw nf('Comment not found');
    return this.file(userId, 'comment', commentId, reason, details);
  }
  async list(status: string, limit: number, cursor?: string) {
    const rows = await this.db.report.findMany({ where: { status: status as any }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor } } : {}) });
    const more = rows.length > limit; return { items: more ? rows.slice(0, limit) : rows, nextCursor: more ? rows[limit].id : null };
  }
  async resolve(adminId: string, id: string, action: AdminAction) {
    const rep = await this.db.report.findUnique({ where: { id } }); if (!rep) throw nf('Report not found');
    const { status, removeContent } = decide(action);
    // Every open report on this target is resolved together, so every reporter must hear the
    // outcome - not just the one whose row the admin happened to click.
    const reporters = [...new Set((await this.db.report.findMany({
      where: { targetType: rep.targetType, targetId: rep.targetId, status: 'open' },
      select: { reporterId: true },
    })).map((r) => r.reporterId))];
    await this.db.$transaction(async (tx) => {
      if (removeContent) {
        const now = new Date();
        if (rep.targetType === 'post') await tx.post.updateMany({ where: { id: rep.targetId, deletedAt: null }, data: { deletedAt: now } });
        else { const c = await tx.comment.findFirst({ where: { id: rep.targetId, deletedAt: null } });
          if (c) { await tx.comment.update({ where: { id: c.id }, data: { deletedAt: now } }); await tx.post.update({ where: { id: c.postId }, data: { commentsCount: { decrement: 1 } } }); } }
      }
      // resolve every open report on the same target
      await tx.report.updateMany({ where: { targetType: rep.targetType, targetId: rep.targetId, status: 'open' }, data: { status, resolvedBy: adminId, resolvedAt: new Date() } });
    });
    if (removeContent && rep.targetType === 'post') {
      // The author has to learn about the removal; `post.deleted` alone carried no author id and
      // nothing consumed it, so the post silently vanished for them.
      const post = await this.db.post.findUnique({ where: { id: rep.targetId }, select: { authorId: true } });
      await this.events.publish('post.moderated', { postId: rep.targetId, authorId: post?.authorId ?? null, adminId, action: 'remove' });
      await this.events.publish('post.deleted', { postId: rep.targetId, authorId: post?.authorId ?? null, moderated: true });
    }
    if (removeContent && rep.targetType === 'comment') {
      // Same rule as posts: the comment's author must be told it was removed.
      const c = await this.db.comment.findUnique({ where: { id: rep.targetId }, select: { authorId: true, postId: true } });
      await this.events.publish('comment.moderated', { commentId: rep.targetId, postId: c?.postId ?? null, authorId: c?.authorId ?? null, adminId, action: 'remove' });
    }
    // Tell each reporter what was decided: content removed, or reviewed and left up.
    for (const reporterId of reporters) {
      await this.events.publish('report.resolved', {
        reportId: id,
        reporterId,
        adminId,
        action,
        targetType: rep.targetType,
        targetId: rep.targetId,
        // A removed post cannot be opened any more, so only a dismissal keeps the deep link.
        openTargetId: !removeContent && rep.targetType === 'post' ? rep.targetId : null,
      });
    }
    return { id, status, notified: reporters.length };
  }
  /** Admin view of a reported post, including removed and non-public content. */
  async adminPost(id: string) {
    const p = await this.db.post.findUnique({ where: { id }, select: { id: true, authorId: true, caption: true, mediaUrls: true, visibility: true, createdAt: true, deletedAt: true } });
    if (!p) throw nf('Post not found');
    return { id: p.id, authorId: p.authorId, caption: p.caption, mediaUrls: p.mediaUrls as string[], visibility: p.visibility, createdAt: p.createdAt, deletedAt: p.deletedAt, removed: !!p.deletedAt };
  }
  /** Undo a moderation removal: the post becomes visible again and the author is told. */
  async restorePost(adminId: string, postId: string) {
    const p = await this.db.post.findUnique({ where: { id: postId }, select: { id: true, authorId: true, deletedAt: true } });
    if (!p) throw nf('Post not found');
    if (!p.deletedAt) return { id: postId, restored: false, alreadyVisible: true };
    await this.db.post.update({ where: { id: postId }, data: { deletedAt: null } });
    await this.events.publish('post.moderated', { postId, authorId: p.authorId, adminId, action: 'restore' });
    return { id: postId, restored: true };
  }
  /** Admin view of a reported comment, including removed content. */
  async adminComment(id: string) {
    const c = await this.db.comment.findUnique({ where: { id }, select: { id: true, postId: true, authorId: true, content: true, createdAt: true, deletedAt: true } });
    if (!c) throw nf('Comment not found');
    return { id: c.id, postId: c.postId, authorId: c.authorId, content: c.content, createdAt: c.createdAt, deletedAt: c.deletedAt, removed: !!c.deletedAt };
  }
  /** Undo a moderation removal of a comment; its post's comment count is restored too. */
  async restoreComment(adminId: string, id: string) {
    const c = await this.db.comment.findUnique({ where: { id }, select: { id: true, postId: true, authorId: true, deletedAt: true } });
    if (!c) throw nf('Comment not found');
    if (!c.deletedAt) return { id, restored: false, alreadyVisible: true };
    await this.db.$transaction([
      this.db.comment.update({ where: { id }, data: { deletedAt: null } }),
      this.db.post.update({ where: { id: c.postId }, data: { commentsCount: { increment: 1 } } }),
    ]);
    await this.events.publish('comment.moderated', { commentId: id, postId: c.postId, authorId: c.authorId, adminId, action: 'restore' });
    return { id, restored: true };
  }
  async stats() { const [open, posts] = await Promise.all([this.db.report.count({ where: { status: 'open' } }), this.db.post.count({ where: { deletedAt: null } })]); return { openReports: open, posts }; }
}
