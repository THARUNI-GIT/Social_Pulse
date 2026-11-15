import { assertChatMedia, isAllowedChatMedia } from './media';

const BASE = 'http://localhost:9000';
const BUCKET = 'socialpulse-media';

describe('chat media allowlist', () => {
  it('accepts only URLs inside the platform bucket', () => {
    expect(isAllowedChatMedia(`${BASE}/${BUCKET}/post/user/1.png`, BASE, BUCKET)).toBe(true);
    expect(isAllowedChatMedia('https://evil.example/tracker.png', BASE, BUCKET)).toBe(false);
    expect(isAllowedChatMedia(`${BASE}/other-bucket/1.png`, BASE, BUCKET)).toBe(false);
    expect(isAllowedChatMedia(`${BASE}/${BUCKET}/../../etc/passwd`, BASE, BUCKET)).toBe(false);
    expect(isAllowedChatMedia('', BASE, BUCKET)).toBe(false);
    expect(isAllowedChatMedia(42, BASE, BUCKET)).toBe(false);
  });

  it('is a no-op when storage is not configured', () => {
    expect(isAllowedChatMedia('https://evil.example/x.png', undefined, undefined)).toBe(true);
  });

  it('assertChatMedia throws for a foreign URL and passes a platform one', () => {
    const before = { url: process.env.MINIO_PUBLIC_URL, bucket: process.env.MINIO_BUCKET };
    process.env.MINIO_PUBLIC_URL = BASE;
    process.env.MINIO_BUCKET = BUCKET;
    try {
      expect(() => assertChatMedia(['https://evil.example/x.png'])).toThrow();
      expect(() => assertChatMedia([`${BASE}/${BUCKET}/post/user/1.png`])).not.toThrow();
      expect(() => assertChatMedia(undefined)).not.toThrow();
    } finally {
      if (before.url === undefined) delete process.env.MINIO_PUBLIC_URL; else process.env.MINIO_PUBLIC_URL = before.url;
      if (before.bucket === undefined) delete process.env.MINIO_BUCKET; else process.env.MINIO_BUCKET = before.bucket;
    }
  });
});
