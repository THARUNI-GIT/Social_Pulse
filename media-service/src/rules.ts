import { BadRequestException } from '@nestjs/common';
export type Kind = 'avatar' | 'post' | 'video';
const MB = 1024 * 1024;
export const LIMITS: Record<Kind, { maxBytes: number; types: Record<string, string> }> = {
  avatar: { maxBytes: 2 * MB, types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } },
  post: { maxBytes: 8 * MB, types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } },
  // Videos get their own kind so the (larger) size limit never applies to images, and the MIME
  // allowlist stays explicit instead of trusting the client's extension.
  video: { maxBytes: 50 * MB, types: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv' } },
};
const bad = (code: string, message: string) => new BadRequestException({ code, message });
/** Returns the file extension for a valid request or throws. */
export function validateUpload(kind: Kind, contentType: string, size: number): string {
  const l = LIMITS[kind]; if (!l) throw bad('INVALID_KIND', 'kind must be avatar, post or video');
  const ext = l.types[contentType]; if (!ext) throw bad('INVALID_TYPE', `Allowed types: ${Object.keys(l.types).join(', ')}`);
  if (!Number.isFinite(size) || size <= 0) throw bad('INVALID_SIZE', 'size must be a positive number');
  if (size > l.maxBytes) throw bad('FILE_TOO_LARGE', `Max ${Math.floor(l.maxBytes / MB)}MB for ${kind}`);
  return ext;
}
const KINDS = Object.keys(LIMITS).join('|');
export const objectKey = (kind: Kind, userId: string, id: string, ext: string) => `${kind}/${userId}/${id}.${ext}`;
/** A delete may only target the caller's own folder. */
export const ownsKey = (key: string, userId: string) => new RegExp(`^(${KINDS})/[^/]+/[^/]+$`).test(key) && key.split('/')[1] === userId && !key.includes('..');
