// One-off: render PWA icons and the default social image from SVG. Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs';

const mark = (size, pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-pad} ${-pad} ${64 + pad * 2} ${64 + pad * 2}">
<rect x="${-pad}" y="${-pad}" width="${64 + pad * 2}" height="${64 + pad * 2}" fill="#2f4fd8"/>
<circle cx="32" cy="32" r="17" fill="none" stroke="#fff" stroke-width="5"/><circle cx="32" cy="32" r="6" fill="#ffd166"/>
<path d="M32 6v8M32 50v8M6 32h8M50 32h8" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`;

await sharp(Buffer.from(mark(192, 6))).png().toFile('public/icon-192.png');
await sharp(Buffer.from(mark(512, 6))).png().toFile('public/icon-512.png');

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2f8f"/><stop offset="1" stop-color="#2f4fd8"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<circle cx="1040" cy="120" r="260" fill="#fff" opacity=".05"/><circle cx="160" cy="560" r="200" fill="#fff" opacity=".05"/>
<g transform="translate(540 120) scale(1.9)"><circle cx="32" cy="32" r="17" fill="none" stroke="#fff" stroke-width="5"/><circle cx="32" cy="32" r="6" fill="#ffd166"/><path d="M32 6v8M32 50v8M6 32h8M50 32h8" stroke="#fff" stroke-width="5" stroke-linecap="round"/></g>
<text x="600" y="390" text-anchor="middle" font-family="Geeza Pro, Vazirmatn, Tahoma, sans-serif" font-weight="700" font-size="76" fill="#fff">فیوچر فوکوس</text>
<text x="600" y="470" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="38" fill="#c9d4ff" letter-spacing="6">FUTURE FOCUS</text>
<text x="600" y="540" text-anchor="middle" font-family="Geeza Pro, Vazirmatn, Tahoma, sans-serif" font-size="34" fill="#e6ebff">اخبار فناوری و آینده</text>
</svg>`;
await sharp(Buffer.from(og)).png().toFile('public/og.png');
console.log('icons written', fs.readdirSync('public'));
