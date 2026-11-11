// Makes a VAPID key pair for notifications (api/push.js). Run once: node scripts/vapid.mjs
// Then in Vercel → Settings → Environment Variables: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or
// https: contact), PUSH_SECRET (any long random string); and the same PUSH_SECRET as a GitHub Actions secret, which the
// site workflow uses to announce new stories (scripts/notify.mjs). Keep the private key and the secret private.
// Changing the keys later unsubscribes every reader.
import { createECDH, randomBytes } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log(`PUSH_SECRET=${randomBytes(24).toString('base64url')}`);
