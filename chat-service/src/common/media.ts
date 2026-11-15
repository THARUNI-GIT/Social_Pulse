/**
 * Chat attachments arrive from the client, exactly like post media. They must point inside our own
 * object bucket, otherwise a message can embed an arbitrary third-party URL (tracking pixel,
 * phishing image) that the app renders as its own content.
 *
 * Unset storage configuration disables the check, matching content-service's behaviour, so a
 * deployment without media still works.
 */
export function isAllowedChatMedia(url: unknown, publicUrl = process.env.MINIO_PUBLIC_URL, bucket = process.env.MINIO_BUCKET): boolean {
  if (typeof url !== 'string' || !url) return false;
  if (!publicUrl || !bucket) return true;
  if (url.includes('..')) return false;
  return url.startsWith(`${publicUrl.replace(/\/+$/, '')}/${bucket}/`);
}

/** Throws a VALIDATION_ERROR-coded error the socket layer turns into an `error` event. */
export function assertChatMedia(urls: unknown): void {
  if (!Array.isArray(urls)) return;
  for (const url of urls) {
    if (!isAllowedChatMedia(url)) {
      throw Object.assign(new Error('Attachments must point at the platform media bucket'), { code: 'INVALID_MEDIA_URL' });
    }
  }
}
