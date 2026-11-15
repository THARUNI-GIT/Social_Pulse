import { createHash, createHmac } from 'crypto';

const sha256 = (d: Buffer | string) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();

export interface CorsOptions {
  endpoint: string; // http://minio:4566 or http://localhost:9000
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  origins: string[];
}

/**
 * Builds the bucket CORS configuration that lets the browser upload directly to a presigned POST.
 *
 * This is what makes profile and post image/video uploads work in the UI: without CORS headers on
 * the bucket the browser refuses the multipart POST with a generic "Failed to fetch", while
 * non-browser clients (curl, node) succeed — which is why the API-level tests never caught it.
 */
/** XML-escapes a value so a crafted origin can never close the element or add a new rule. */
export const escapeXml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function corsXml(origins: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<CORSConfiguration><CORSRule>' +
    '<AllowedMethod>GET</AllowedMethod>' +
    '<AllowedMethod>PUT</AllowedMethod>' +
    '<AllowedMethod>POST</AllowedMethod>' +
    '<AllowedMethod>DELETE</AllowedMethod>' +
    '<AllowedMethod>HEAD</AllowedMethod>' +
    '<AllowedHeader>*</AllowedHeader>' +
    origins.map((o) => `<AllowedOrigin>${escapeXml(o)}</AllowedOrigin>`).join('') +
    '<ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-request-id</ExposeHeader>' +
    '<MaxAgeSeconds>3000</MaxAgeSeconds>' +
    '</CORSRule></CORSConfiguration>'
  );
}

/**
 * Sends a signed `PUT /<bucket>?cors`. The `minio` client library has no bucket-CORS API, so this
 * hand-rolls the SigV4 signature needed by both MinIO and Amazon S3 (works with LocalStack too).
 */
export async function putBucketCors(o: CorsOptions, fetchImpl: typeof fetch = fetch): Promise<number> {
  const url = new URL(`${o.endpoint.replace(/\/+$/, '')}/${o.bucket}?cors`);
  const body = corsXml(o.origins);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);

  const canonicalHeaders =
    `content-type:application/xml\n` + `host:${url.host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${o.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${o.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, o.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/xml',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  return res.status;
}
