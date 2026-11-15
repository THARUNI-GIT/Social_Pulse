import { buildGroupMembers, isUserId, MAX_GROUP_MEMBERS, normalizeGroupName, systemDedupeKey, systemMessageText } from './groups';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('isUserId', () => {
  it('accepts UUIDs and rejects anything else', () => {
    expect(isUserId(A)).toBe(true);
    expect(isUserId('alice')).toBe(false);
    expect(isUserId(undefined)).toBe(false);
  });
});

describe('normalizeGroupName', () => {
  it('trims, collapses whitespace and pads nothing', () => {
    expect(normalizeGroupName('  Trip   Planning ')).toBe('Trip Planning');
    expect(normalizeGroupName('   ')).toBeNull();
    expect(normalizeGroupName(undefined)).toBeNull();
  });
  it('caps a long name instead of rejecting it', () => {
    expect(normalizeGroupName('x'.repeat(200))!.length).toBe(60);
  });
});

describe('buildGroupMembers', () => {
  it('always includes the creator first and dedupes invitees', () => {
    const r = buildGroupMembers(A, [B, B, C]);
    expect(r.members).toEqual([A, B, C]);
    expect(r.error).toBeUndefined();
  });
  it('requires at least one other member', () => {
    expect(buildGroupMembers(A, []).error).toBe('TOO_FEW');
    expect(buildGroupMembers(A, [A]).error).toBe('TOO_FEW');
  });
  it('rejects malformed member ids', () => {
    expect(buildGroupMembers(A, ['not-a-uuid']).error).toBe('INVALID_MEMBER');
  });
  it('caps membership at the maximum', () => {
    const many = Array.from({ length: MAX_GROUP_MEMBERS + 5 }, (_, i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
    expect(buildGroupMembers(A, many).error).toBe('TOO_MANY');
  });
  it('accepts exactly the maximum', () => {
    const many = Array.from({ length: MAX_GROUP_MEMBERS - 1 }, (_, i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
    expect(buildGroupMembers(A, many).error).toBeUndefined();
  });
});

describe('systemMessageText', () => {
  it('describes each membership event', () => {
    expect(systemMessageText({ event: 'created', actorId: A })).toContain('created the group');
    expect(systemMessageText({ event: 'member_added', actorId: A, targetId: B })).toContain('added');
    expect(systemMessageText({ event: 'member_removed', actorId: A, targetId: B })).toContain('removed');
    expect(systemMessageText({ event: 'member_left', actorId: B })).toContain('left the group');
    expect(systemMessageText({ event: 'renamed', actorId: A, name: 'Weekend' })).toContain('Weekend');
  });
  it('never includes a control character or markup from the group name', () => {
    const text = systemMessageText({ event: 'renamed', actorId: A, name: '<script>x</script>' });
    expect(text).toContain('<script>x</script>'); // stored verbatim; React escapes it at render
    expect(text).not.toContain('\u0000');
  });
  it('falls back safely when ids are missing', () => {
    expect(systemMessageText({ event: 'member_added' })).toContain('someone');
  });
});

describe('systemDedupeKey', () => {
  it('is stable for a retry inside the window', () => {
    const p = { event: 'member_added' as const, actorId: A, targetId: B };
    expect(systemDedupeKey('c1', p, 5000, 10_000)).toBe(systemDedupeKey('c1', p, 5000, 12_000));
  });
  it('differs for a genuine repeat action in a later window', () => {
    const p = { event: 'member_added' as const, actorId: A, targetId: B };
    expect(systemDedupeKey('c1', p, 5000, 10_000)).not.toBe(systemDedupeKey('c1', p, 5000, 20_000));
  });
  it('separates different conversations, actors, targets and events', () => {
    const now = 10_000;
    const base = systemDedupeKey('c1', { event: 'member_added', actorId: A, targetId: B }, 5000, now);
    expect(systemDedupeKey('c2', { event: 'member_added', actorId: A, targetId: B }, 5000, now)).not.toBe(base);
    expect(systemDedupeKey('c1', { event: 'member_added', actorId: B, targetId: A }, 5000, now)).not.toBe(base);
    expect(systemDedupeKey('c1', { event: 'member_removed', actorId: A, targetId: B }, 5000, now)).not.toBe(base);
  });
});
