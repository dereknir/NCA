/**
 * /covers/w{80,448}/<artist>/<name>.webp — public/covers 底下每張封面的 WebP 縮圖 (網址規則見 src/lib/covers.ts)
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { COVER_WIDTHS } from '../../../lib/covers';

const ROOT = path.join(process.cwd(), 'public/covers');

export function getStaticPaths() {
  const files = readdirSync(ROOT, { recursive: true, encoding: 'utf-8' })
    .filter(f => /\.(jpe?g|png)$/i.test(f) && !/^w\d+\//.test(f));
  return COVER_WIDTHS.flatMap(w => files.map(f => ({
    params: { w: `w${w}`, file: f.replace(/\.(jpe?g|png)$/i, '.webp') },
    props: { src: path.join(ROOT, f), width: w },
  })));
}

export async function GET({ props }: { props: { src: string; width: number } }) {
  const buf = await sharp(props.src)
    .resize({ width: props.width, height: props.width, fit: 'cover', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/webp' } });
}
