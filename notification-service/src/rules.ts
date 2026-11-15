export type NType = 'like' | 'comment' | 'share' | 'follow' | 'message' | 'moderation' | 'report';
export interface Draft { recipientId: string; type: NType; actorId: string; targetId?: string; groupKey?: string; preview?: string }
const clip = (s?: string) => (s ? (s.length > 80 ? s.slice(0, 77) + '...' : s) : undefined);
/** Maps an app.events message to zero or more notification drafts. Self-notifications are dropped.
 *  comment.created / message.sent payloads were not in the provided code: field names below are tolerant guesses (see docs/PROGRESS-LOG.md). */
export function toDrafts(key: string, p: any): Draft[] {
  const out: Draft[] = [];
  switch (key) {
    case 'post.liked': out.push({ recipientId: p.authorId, type: 'like', actorId: p.userId, targetId: p.postId, groupKey: `like:${p.postId}` }); break;
    case 'post.shared': out.push({ recipientId: p.authorId, type: 'share', actorId: p.userId, targetId: p.postId, preview: clip(p.comment) }); break;
    case 'comment.created': out.push({ recipientId: p.postAuthorId ?? p.authorId_post ?? p.postOwnerId, type: 'comment', actorId: p.authorId ?? p.userId, targetId: p.postId, preview: clip(p.content ?? p.text) }); break;
    case 'user.followed': out.push({ recipientId: p.followingId, type: 'follow', actorId: p.followerId, targetId: p.followerId }); break;
    case 'report.resolved': {
      // Sent to the person who reported the content, after an admin removes or clears it.
      // `openTargetId` is null when the content was removed (nothing left to link to).
      out.push({
        recipientId: p.reporterId,
        type: 'moderation',
        actorId: p.adminId || 'moderation',
        targetId: p.openTargetId ?? undefined,
        preview: p.action === 'remove'
          ? 'The content you reported was removed.'
          : 'We reviewed your report and no action was needed.',
      });
      break;
    }
    case 'comment.moderated': {
      out.push({
        recipientId: p.authorId,
        type: 'moderation',
        actorId: p.adminId || 'moderation',
        // A restored comment links to the post it belongs to; removed content has no target.
        targetId: p.action === 'restore' ? (p.postId ?? undefined) : undefined,
        preview: p.action === 'restore' ? 'A moderator restored your comment.' : 'A moderator removed your comment after a report.',
      });
      break;
    }
    case 'post.moderated': {
      // An admin removed or restored the author's post. Self-notifications are dropped below.
      out.push({
        recipientId: p.authorId,
        type: 'moderation',
        actorId: p.adminId || 'moderation',
        targetId: p.action === 'restore' ? p.postId : undefined,
        preview: p.action === 'restore' ? 'A moderator restored your post.' : 'A moderator removed your post after a report.',
      });
      break;
    }
    case 'message.sent': {
      const sender = p.senderId ?? p.userId;
      const rcpts: string[] = p.recipientIds ?? (p.recipientId ? [p.recipientId] : (p.participantIds ?? []).filter((x: string) => x !== sender));
      for (const r of rcpts) out.push({ recipientId: r, type: 'message', actorId: sender, targetId: p.conversationId, groupKey: `msg:${p.conversationId}`, preview: clip(p.preview ?? p.content) });
      break;
    }
  }
  return out.filter((d) => d.recipientId && d.actorId && d.recipientId !== d.actorId);
}
/**
 * Admin alerts are the one notification whose recipients are not in the payload: they depend on
 * who currently holds the admin role, which only user-service knows. The caller resolves the ids
 * and hands them here, so the mapping stays a pure function and testable.
 */
export function adminDrafts(p: any, adminIds: string[]): Draft[] {
  const target = p?.targetType === 'comment' ? 'comment' : 'post';
  const reason = typeof p?.reason === 'string' && p.reason ? p.reason : 'unspecified';
  return [...new Set(adminIds)].
    filter((id) => id && id !== p?.reporterId).
    map((recipientId) => ({
      recipientId,
      type: 'report' as NType,
      actorId: String(p.reporterId),
      // A comment report has no page of its own; open the post it belongs to when known.
      targetId: p.targetId,
      preview: `New ${target} report: ${reason}`,
    }));
}

/** Cursor = base64(updatedAtMs_id) over sort [updatedAt desc, _id desc]. */
export const encodeCursor = (d: Date, id: string) => Buffer.from(`${d.getTime()}_${id}`).toString('base64url');
export function decodeCursor(c?: string): { t: Date; id: string } | null {
  if (!c) return null; const [ms, id] = Buffer.from(c, 'base64url').toString().split('_');
  return ms && id && !isNaN(+ms) ? { t: new Date(+ms), id } : null;
}
