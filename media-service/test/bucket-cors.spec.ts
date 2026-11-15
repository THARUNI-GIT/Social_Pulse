import { corsXml, putBucketCors } from '../src/bucket-cors';

describe('bucket CORS', () => {
  it('allows only the configured origins, all methods and any header', () => {
    const xml = corsXml(['http://localhost:5173', 'https://app.example.com']);
    expect(xml).toContain('<AllowedOrigin>http://localhost:5173</AllowedOrigin>');
    expect(xml).toContain('<AllowedOrigin>https://app.example.com</AllowedOrigin>');
    expect(xml).toContain('<AllowedMethod>POST</AllowedMethod>');
    expect(xml).toContain('<AllowedMethod>PUT</AllowedMethod>');
    expect(xml).toContain('<AllowedHeader>*</AllowedHeader>');
  });

  it('escapes markup out of an origin so the XML cannot be broken or widened', () => {
    const xml = corsXml(['http://x" /><AllowedOrigin>http://evil.example']);
    // Exactly one rule, and the injected tag is inert text rather than a new element.
    expect((xml.match(/<AllowedOrigin>/g) ?? []).length).toBe(1);
    expect(xml).toContain('&lt;AllowedOrigin&gt;'); // markup became inert text
  });

  it('signs a PUT bucket-cors request with SigV4 and sends the XML body', async () => {
    const calls: any[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return { status: 200, text: async () => '' };
    }) as any;

    const status = await putBucketCors(
      {
        endpoint: 'http://localhost:9000',
        bucket: 'socialpulse-media',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        region: 'us-east-1',
        origins: ['http://localhost:5173'],
      },
      fetchImpl
    );

    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('http://localhost:9000/socialpulse-media?cors');
    expect(init.method).toBe('PUT');
    const auth = String(init.headers.Authorization);
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=minioadmin\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(init.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(String(init.body)).toContain('<CORSConfiguration>');
  });

  it('propagates a non-2xx status so the caller can log it', async () => {
    const fetchImpl = (async () => ({ status: 403, text: async () => 'Forbidden' })) as any;
    const status = await putBucketCors(
      { endpoint: 'http://localhost:9000', bucket: 'b', accessKey: 'k', secretKey: 's', region: 'us-east-1', origins: ['http://localhost:5173'] },
      fetchImpl
    );
    expect(status).toBe(403);
  });
});
