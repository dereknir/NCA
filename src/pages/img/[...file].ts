/**
 * /img/<資料夾>/<檔名>.webp — src/lib/images.ts 列出的資料夾裡每張圖的 WebP 版
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_DIRS } from '../../lib/images';

const PUBLIC = path.join(process.cwd(), 'public');

export function getStaticPaths() {
  const paths = Object.entries(IMAGE_DIRS).flatMap(([dir, width]) =>
    readdirSync(path.join(PUBLIC, dir))
      .filter(f => /\.(jpe?g|png)$/i.test(f))
      .map(f => {
        // 網址會被解碼, 檔名有 % # ? 就對不回來; 直接擋下, 不要等上線才發現破圖
        if (/[%#?]/.test(f)) throw new Error(`public/${dir}/${f}: 檔名不能有 % # ?, 請改名`);
        return {
          params: { file: `${dir}/${f.replace(/\.(jpe?g|png)$/i, '.webp')}` },
          props: { src: path.join(PUBLIC, dir, f), width },
        };
      }));
  // x.jpg 跟 x.png 會撞成同一個 x.webp, 其中一張會被默默丟掉
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p.params.file)) throw new Error(`/img/${p.params.file}: 同一個資料夾有同名不同副檔名的圖, 請改名`);
    seen.add(p.params.file);
  }
  return paths;
}

export async function GET({ props }: { props: { src: string; width: number } }) {
  const buf = await sharp(props.src)
    .resize({ width: props.width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/webp' } });
}
