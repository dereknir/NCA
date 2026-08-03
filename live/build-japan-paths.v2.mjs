/**
 * build-japan-paths.mjs v2 — 像素空間簡化
 * 投影後:環內鄰點 <1.5px 剔除、環投影面積 <10px² 丟棄、座標整數。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as topojson from 'topojson-client';
import { geoMercator } from 'd3-geo';

const topo = JSON.parse(readFileSync('japan.topojson', 'utf-8'));
const fc = topojson.feature(topo, topo.objects.japan);
const W = 700, H = 780;
const shortName = n => n === '北海道' ? n : n.replace(/[都府県]$/, '');

const okinawa = fc.features.find(f => f.properties.nam_ja === '沖縄県');
const mains = { type: 'FeatureCollection', features: fc.features.filter(f => f !== okinawa) };
const projMain = geoMercator().fitExtent([[8, 84], [W - 8, H - 8]], mains);
const projOki = geoMercator().fitExtent([[14, 14], [150, 92]], okinawa);

const MIN_D2 = 1.5 * 1.5, MIN_AREA = 10;

function ringToPts(ring, proj) {
  const pts = [];
  for (const c of ring) {
    const [x, y] = proj(c);
    const p = [Math.round(x), Math.round(y)];
    const last = pts[pts.length - 1];
    if (!last || (last[0] - p[0]) ** 2 + (last[1] - p[1]) ** 2 >= MIN_D2) pts.push(p);
  }
  return pts;
}
const area = pts => Math.abs(pts.reduce((a, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return a + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

function featurePath(f, proj) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let d = '', cx = 0, cy = 0, cw = 0;
  for (const poly of polys) {
    for (let ri = 0; ri < poly.length; ri++) {
      const pts = ringToPts(poly[ri], proj);
      if (pts.length < 4) continue;
      const a = area(pts);
      if (a < MIN_AREA) continue;
      if (ri === 0 && a > cw) {   // 最大外環的形心當標記錨點
        cw = a;
        cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      }
      d += 'M' + pts.map(p => p.join(' ')).join('L') + 'Z';
    }
  }
  return { d, cx: Math.round(cx), cy: Math.round(cy) };
}

const out = { meta: { w: W, h: H, inset: [8, 8, 158, 100], source: 'dataofjapan/land (Natural Earth)' }, prefs: {} };
for (const f of fc.features) {
  const oki = f === okinawa;
  const { d, cx, cy } = featurePath(f, oki ? projOki : projMain);
  out.prefs[shortName(f.properties.nam_ja)] = { d, cx, cy, inset: oki || undefined };
}
const json = JSON.stringify(out);
writeFileSync('japan_paths.json', json);
const anchors = (json.match(/[ML]/g) || []).length;
console.log(`✓ japan_paths.json  47 縣  ${(json.length / 1024).toFixed(0)}KB  錨點 ${anchors}`);
