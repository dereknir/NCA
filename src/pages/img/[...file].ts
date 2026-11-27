/**
 * /img/<資料夾>/<檔名>.webp — src/lib/images.ts 列出的資料夾裡每張圖的 WebP 版
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_DIRS } from '../../lib/images';

const PUBLIC = path.join(process.cwd(), 'public');

export function getStaticPaths() {
  return Object.entries(IMAGE_DIRS).flatMap(([dir, width]) =>
    readdirSync(path.join(PUBLIC, dir))
      .filter(f => /\.(jpe?g|png)$/i.test(f))
      .map(f => ({
        params: { file: `${dir}/${f.replace(/\.(jpe?g|png)$/i, '.webp')}` },
        props: { src: path.join(PUBLIC, dir, f), width },
      })));
}

export async function GET({ props }: { props: { src: string; width: number } }) {
  const buf = await sharp(props.src)
    .resize({ width: props.width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/webp' } });
}
