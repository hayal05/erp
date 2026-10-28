import { HttpError } from '../middleware/error.js';
import { isQrTokenFormat } from './qrToken.js';
import { MAX_BYTES, looksLikeJpeg } from './cloudinary.js';

// Request body of POST /api/attendance/scan: { token, photo } where photo is the raw base64 of a JPEG
// (no "data:" prefix). Pure, so it is unit-tested without Express or a database.
export const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4 + 4;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseScanBody(body) {
  const fields = {};
  const { token, photo } = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!isQrTokenFormat(token)) fields.token = 'A valid QR code is required';

  let buffer = null;
  if (typeof photo !== 'string' || !photo) fields.photo = 'A selfie is required';
  else if (photo.length > MAX_BASE64_CHARS) fields.photo = 'The photo is too large';
  else if (!BASE64_RE.test(photo)) fields.photo = 'The photo is not valid';
  else {
    buffer = Buffer.from(photo, 'base64');
    if (buffer.length > MAX_BYTES) fields.photo = 'The photo is too large';
    else if (!looksLikeJpeg(buffer)) fields.photo = 'The photo must be a JPEG image';
  }

  if (Object.keys(fields).length) throw new HttpError(400, 'Check the highlighted fields', 'validation', { fields });
  return { token, photo: buffer };
}
