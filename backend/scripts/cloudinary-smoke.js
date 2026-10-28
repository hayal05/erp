// Manual check of the "private selfie" promise against the REAL Cloudinary account (needs network + .env):
//   node --env-file=../.env scripts/cloudinary-smoke.js
// Uploads a tiny JPEG, shows that the plain delivery URL is refused, that a signed URL works, then deletes it.
import { photos } from '../src/services/cloudinary.js';
import { config } from '../src/config.js';

const JPEG_1x1 = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const id = await photos.upload(JPEG_1x1);
try {
  const plain = `https://res.cloudinary.com/${config.cloudinary.cloudName}/image/upload/${id}.jpg`;
  const authed = `https://res.cloudinary.com/${config.cloudinary.cloudName}/image/authenticated/${id}.jpg`;
  const { url } = await photos.signedUrl(id, 60);
  const status = async (u) => (await fetch(u)).status;
  console.log('public upload URL      (expect 404):', await status(plain));
  console.log('unsigned authenticated (expect 401/404):', await status(authed));
  console.log('signed download URL    (expect 200):', await status(url));
} finally {
  await photos.delete(id);
  console.log('deleted', id);
}
