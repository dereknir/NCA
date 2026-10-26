# にしなカードガチャ — 扭蛋原型(給 Derek 實測 + Claude Code 整合)

## 跑起來
```bash
npm run dev            # 開 http://localhost:4321/gacha/
# 或不開 astro: cd public && python -m http.server 8000 → http://localhost:8000/gacha/
```
需 http(FontFace/fetch 不吃 file://);字型走站根的 /fonts/pixel/, 所以要從 public/ 當根目錄起 server。測試期不限抽數。

## 已驗證 / 待實測
✅ node 端驗證:版面計算 parity 一致、背景美術逐位元一致、seed 可重現、
   pool 1215 張身分
⚠️ 待瀏覽器實測(本開發環境無瀏覽器):FontFace 載入、canvas 文字定位
   (textBaseline='top' 與 node 版可能有 1-2px 落差,微調 put() 的 y 即可)、
   OffscreenCanvas 相容性(現代瀏覽器皆支援)

## 三層模型落地
- 身分 = `${songId}#${lineIndex}`(1215 種),顯示於卡下方,localStorage
  紀錄每抽(`nishina-gacha-log`),未來收集冊回溯計入
- 稀有度:RATES = LIVE1/SR5/R16/N78;CURATED 表為空 → 實際 100% N,
  站長填 `'nishina-plum#14'` 格式即生效,池空自動降級
- 印刷:print seed 顯示為 hex,同 seed 可重現同一張(未來引繼碼基礎)
- 稀有度視覺:N 隨機框 / R 實線框 / SR·LIVE 金框(engine.frame 的 gold 參數)

## 站長策展區(index.html 頂部)
songUrl 路由 / RATES / CURATED 三處,全在 `===== 站長策展區 =====` 註解內。
accent 與 motif 目前為暫定 hash 分配(6 首已定案),frontmatter 策展後
重新產出 pool.json(repo 內目前沒有專用腳本, 手動維護;LIVE 池由 `scripts/build_gacha_live_pool.py` 生成 live_pool.json)。字型子集不在此產生, 走全站的 `scripts/build_site_charset.py` → `scripts/build_pixel_fonts.py`。

## 檔案
index.html / engine.js(引擎,node 可測)/ machine.js / backpack.js / pool.json / live_pool.json;字型走全站共用的 /fonts/pixel/fp{12,10,8}-site-{ja,zh_hant}.woff2(scripts/build_pixel_fonts.py 生成, 字集已含 gacha 字串)
