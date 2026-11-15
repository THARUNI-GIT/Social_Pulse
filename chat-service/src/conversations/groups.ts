export type SystemEvent = 'created' | 'member_added' | 'member_removed' | 'member_left' | 'renamed';

/** Actors/targets are always ids; names are optional so the stored value is never authoritative. */
export interface SystemPayload {
  event: SystemEvent;
  actorId?: string;
  targetId?: string;
  name?: string;
}

/** Fallback text used when the client cannot resolve a display name. Never interpolate raw input. */
export function systemMessageText(p: SystemPayload): string {
  const who = (id?: string) => (id ? `user ${id.slice(0, 8)}` : 'someone');
  switch (p.event) {
    case 'created': return `${who(p.actorId)} created the group`;
    case 'member_added': return `${who(p.actorId)} added ${who(p.targetId)} to the group`;
    case 'member_removed': return `${who(p.actorId)} removed ${who(p.targetId)} from the group`;
    case 'member_left': return `${who(p.actorId)} left the group`;
    case 'renamed': return `${who(p.actorId)} renamed the group${p.name ? ` to "${p.name}"` : ''}`;
    default: return 'Group updated';
  }
}

/**
 * Collapses retries of the same action onto one key. The bucket is intentionally short: a genuine
 * repeat action (add -> remove -> add again) lands in a later bucket and is recorded normally.
 */
export function systemDedupeKey(
  conversationId: string,
  p: SystemPayload,
  bucketMs = 5_000,
  now = Date.now()
): string {
  const bucket = Math.floor(now / bucketMs);
  return [conversationId, p.event, p.actorId ?? '', p.targetId ?? '', p.name ?? '', bucket].join('|');
}

/** Longest allowed group name; longer input is truncated rather than rejected. */
export const MAX_GROUP_MEMBERS = 50;
export const MIN_GROUP_MEMBERS = 2;
export const MAX_GROUP_NAME = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUserId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Trims a group name and rejects blank/over-long input. */
export function normalizeGroupName(raw: unknown): string | null {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length > MAX_GROUP_NAME) return name.slice(0, MAX_GROUP_NAME);
  return name;
}

/**
 * Builds the member list for a group: the creator plus the deduped, format-checked invitees,
 * capped at MAX_GROUP_MEMBERS. Returns an `error` code instead of throwing so callers can pick
 * the HTTP status.
 */
export function buildGroupMembers(
  creatorId: string,
  invited: unknown
): { members: string[]; error?: 'INVALID_MEMBER' | 'TOO_FEW' | 'TOO_MANY' } {
  const list = Array.isArray(invited) ? invited : [];
  const invalid = list.some((id) => !isUserId(id));
  if (invalid) return { members: [], error: 'INVALID_MEMBER' };
  const members = [...new Set([creatorId, ...(list as string[])])];
  if (members.length < MIN_GROUP_MEMBERS) return { members, error: 'TOO_FEW' };
  if (members.length > MAX_GROUP_MEMBERS) return { members, error: 'TOO_MANY' };
  return { members };
}
