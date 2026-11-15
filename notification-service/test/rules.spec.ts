import { adminDrafts, decodeCursor, encodeCursor, toDrafts } from '../src/rules';
describe('notification rules', () => {
  it('skips self-notifications', () => {
    expect(toDrafts('post.liked', { postId: 'p', authorId: 'a', userId: 'a' })).toEqual([]);
    expect(toDrafts('user.followed', { followerId: 'a', followingId: 'a' })).toEqual([]);
  });
  it('likes get a per-post group key; follow targets the follower', () => {
    expect(toDrafts('post.liked', { postId: 'p', authorId: 'a', userId: 'b' })[0]).toMatchObject({ recipientId: 'a', actorId: 'b', groupKey: 'like:p' });
    expect(toDrafts('user.followed', { followerId: 'b', followingId: 'a' })[0]).toMatchObject({ recipientId: 'a', type: 'follow' });
  });
  it('message.sent fans out to recipients except sender', () => {
    const d = toDrafts('message.sent', { conversationId: 'c', senderId: 'a', participantIds: ['a', 'b', 'c2'] });
    expect(d.map((x) => x.recipientId)).toEqual(['b', 'c2']);
  });
  it('report.created fans out to admins, de-duplicates and never alerts the reporter', () => {
    const d = adminDrafts({ reporterId: 'r', targetType: 'post', targetId: 'p', reason: 'spam' }, ['a1', 'a2', 'r', 'a1']);
    expect(d.map((x) => x.recipientId)).toEqual(['a1', 'a2']);
    expect(d[0]).toMatchObject({ type: 'report', actorId: 'r', targetId: 'p' });
    expect(d[0].preview).toContain('post');
    expect(d[0].preview).toContain('spam');
  });
  it('report.created names the target type and survives a missing admin list', () => {
    expect(adminDrafts({ reporterId: 'r', targetType: 'comment', targetId: 'c', reason: 'hate' }, ['a'])[0].preview).toContain('comment');
    expect(adminDrafts({ reporterId: 'r', targetType: 'post', targetId: 'p', reason: 'spam' }, [])).toEqual([]);
  });
  it('report.resolved notifies the reporter with the moderation outcome', () => {
    const removed = toDrafts('report.resolved', { reporterId: 'r', adminId: 'a', action: 'remove', targetType: 'post', targetId: 'p', openTargetId: null });
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ recipientId: 'r', type: 'moderation', actorId: 'a' });
    expect(removed[0].targetId).toBeUndefined(); // removed content has no link target
    expect(removed[0].preview).toContain('removed');

    const kept = toDrafts('report.resolved', { reporterId: 'r', adminId: 'a', action: 'dismiss', targetType: 'post', targetId: 'p', openTargetId: 'p' });
    expect(kept[0]).toMatchObject({ recipientId: 'r', type: 'moderation', targetId: 'p' });
    expect(kept[0].preview).toContain('no action');
  });
  it('comment.moderated tells the author about removal and restore', () => {
    const removed = toDrafts('comment.moderated', { commentId: 'c', postId: 'p', authorId: 'a', adminId: 'admin', action: 'remove' });
    expect(removed[0]).toMatchObject({ recipientId: 'a', type: 'moderation', actorId: 'admin' });
    expect(removed[0].targetId).toBeUndefined();
    expect(removed[0].preview).toContain('removed your comment');

    const restored = toDrafts('comment.moderated', { commentId: 'c', postId: 'p', authorId: 'a', adminId: 'admin', action: 'restore' });
    expect(restored[0]).toMatchObject({ recipientId: 'a', type: 'moderation', targetId: 'p' });
    expect(restored[0].preview).toContain('restored your comment');
  });
  it('post.moderated tells the author about removal and restore', () => {
    const removed = toDrafts('post.moderated', { postId: 'p', authorId: 'a', adminId: 'admin', action: 'remove' });
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ recipientId: 'a', type: 'moderation', actorId: 'admin' });
    expect(removed[0].targetId).toBeUndefined();
    expect(removed[0].preview).toContain('removed');

    const restored = toDrafts('post.moderated', { postId: 'p', authorId: 'a', adminId: 'admin', action: 'restore' });
    expect(restored[0]).toMatchObject({ recipientId: 'a', type: 'moderation', targetId: 'p' });
    expect(restored[0].preview).toContain('restored');
  });
  it('cursor round-trips', () => { const d = new Date(1700000000000); expect(decodeCursor(encodeCursor(d, 'abc'))).toEqual({ t: d, id: 'abc' }); expect(decodeCursor('###')).toBeNull(); });
});
