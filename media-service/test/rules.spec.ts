import { objectKey, ownsKey, validateUpload } from '../src/rules';
describe('media rules', () => {
  it('accepts valid uploads and returns extension', () => { expect(validateUpload('avatar', 'image/png', 1000)).toBe('png'); expect(validateUpload('post', 'image/gif', 5e6)).toBe('gif'); });
  it('rejects bad type, oversize, bad size', () => {
    expect(() => validateUpload('avatar', 'image/gif', 1000)).toThrow(); expect(() => validateUpload('avatar', 'image/png', 3 * 1024 * 1024)).toThrow();
    expect(() => validateUpload('post', 'application/pdf', 10)).toThrow(); expect(() => validateUpload('post', 'image/png', 0)).toThrow();
  });
  it('only lets owners delete their own keys', () => {
    const k = objectKey('post', 'u1', 'abc', 'png'); expect(k).toBe('post/u1/abc.png');
    expect(ownsKey(k, 'u1')).toBe(true); expect(ownsKey(k, 'u2')).toBe(false); expect(ownsKey('post/u1/../u2/x.png', 'u1')).toBe(false);
  });
});

describe('video rules', () => {
  it('accepts the allowlisted video types up to 50MB', () => {
    expect(validateUpload('video', 'video/mp4', 20e6)).toBe('mp4');
    expect(validateUpload('video', 'video/webm', 50 * 1024 * 1024)).toBe('webm');
    expect(validateUpload('video', 'video/quicktime', 1000)).toBe('mov');
  });
  it('rejects a video over the limit, and a video type on the image kinds', () => {
    expect(() => validateUpload('video', 'video/mp4', 51 * 1024 * 1024)).toThrow(/50MB/);
    expect(() => validateUpload('post', 'video/mp4', 1000)).toThrow();
    expect(() => validateUpload('avatar', 'video/mp4', 1000)).toThrow();
  });
  it('rejects non-video MIME types on the video kind', () => {
    expect(() => validateUpload('video', 'image/png', 10)).toThrow();
    expect(() => validateUpload('video', 'application/octet-stream', 10)).toThrow();
  });
  it('keeps video objects in the caller-owned folder', () => {
    const k = objectKey('video', 'u1', 'abc', 'mp4');
    expect(k).toBe('video/u1/abc.mp4');
    expect(ownsKey(k, 'u1')).toBe(true);
    expect(ownsKey(k, 'u2')).toBe(false);
  });
});
