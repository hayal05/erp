import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';

// Selfie storage (spec 7, 22). Photos are uploaded as type "authenticated": the plain delivery URL
// does not work, and the only way to view one is a signed download URL that expires. The database
// stores the public id only, never a URL. Public ids are random and carry no employee data.
export const FOLDER = 'natra/selfies';
export const MAX_BYTES = 600 * 1024;               // the browser compresses to ~100-200 KB; this is a safety cap
export const DEFAULT_URL_TTL_SECONDS = 300;
export const MAX_URL_TTL_SECONDS = 900;
const PUBLIC_ID = /^natra\/selfies\/\d{4}\/[A-Za-z0-9_-]{22,64}$/;

export const isPhotoId = (v) => typeof v === 'string' && PUBLIC_ID.test(v);
export const looksLikeJpeg = (buf) => Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

// `sdk` is the cloudinary v2 object (loaded lazily so the app boots, and tests run, without it).
export function createPhotoStore({ sdk, cfg = config.cloudinary, now = Date.now, random = () => crypto.randomBytes(18).toString('base64url') } = {}) {
  const configured = !!(cfg.cloudName && cfg.apiKey && cfg.apiSecret);
  let ready;
  const client = async () => {
    if (!configured) throw new HttpError(503, 'Photo storage is not configured', 'storage_unavailable');
    ready ??= (async () => {
      const v2 = sdk ?? (await import('cloudinary')).v2;
      v2.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret, secure: true });
      return v2;
    })();
    return ready;
  };
  const checkId = (id) => { if (!isPhotoId(id)) throw new Error('Invalid photo id'); };

  return {
    configured,

    // Returns the new public id. Throws HttpError 400 for a bad image, 502 if Cloudinary fails
    // (the caller must then NOT create an attendance record: upload failure = no attendance).
    async upload(buffer) {
      if (!looksLikeJpeg(buffer)) throw new HttpError(400, 'The photo must be a JPEG image', 'bad_photo');
      if (buffer.length > MAX_BYTES) throw new HttpError(413, 'The photo is too large', 'photo_too_large');
      const v2 = await client();
      const year = new Date(now()).getUTCFullYear();
      const publicId = `${FOLDER}/${year}/${random()}`;
      try {
        await new Promise((resolve, reject) => {
          v2.uploader.upload_stream(
            { public_id: publicId, type: 'authenticated', resource_type: 'image', overwrite: false, unique_filename: false },
            (err, result) => (err || !result ? reject(err ?? new Error('empty upload result')) : resolve(result)),
          ).end(buffer);
        });
      } catch {
        throw new HttpError(502, 'Could not store the photo. Please try again.', 'storage_failed');
      }
      return publicId;
    },

    // Time-limited URL for HR to view one photo. Never cache it or store it.
    async signedUrl(publicId, ttlSeconds = DEFAULT_URL_TTL_SECONDS) {
      checkId(publicId);
      const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_URL_TTL_SECONDS);
      const v2 = await client();
      const expiresAt = Math.floor(now() / 1000) + ttl;
      const url = v2.utils.private_download_url(publicId, 'jpg', { type: 'authenticated', resource_type: 'image', expires_at: expiresAt });
      return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
    },

    // Idempotent: deleting a photo that is already gone is success. Used for orphan cleanup (2.15)
    // and the retention procedure.
    async delete(publicId) {
      checkId(publicId);
      const v2 = await client();
      const res = await v2.uploader.destroy(publicId, { type: 'authenticated', resource_type: 'image', invalidate: true });
      if (res?.result !== 'ok' && res?.result !== 'not found') throw new HttpError(502, 'Could not delete the photo', 'storage_failed');
    },
  };
}

export const photos = createPhotoStore();
