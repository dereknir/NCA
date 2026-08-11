# MANIFEST.md — live-pages.zip 檔案清單(2026-08-11)

## 🌌 宇宙 Hub(最新主戰場)
| 檔案 | 用途 | 狀態 | Claude Code 要做的事 |
|---|---|---|---|
| galaxy.html | 太陽系 hub:shader 行星、克卜勒公轉、操縦席、雷達導航、著陸序列 | ⚡ 最新(雷達導航版)| 整合上站;ROUTES 改成真路徑(現預填 timeline/concerts 相對路徑供離線驗收);FLARE_TEXT 接今日のにしな真資料 |
| shaders/*.frag | 行星/星雲 GLSL 原始碼(嵌入 galaxy 用,亦供未來調整) | 同上 | 不需部署,參考用 |
| planet-hero.js | 行星頁頂著陸場景模組(獨立零依賴) | ✅ 已實裝 | 已完成 |

## 📄 三個 live 頁(hero 版)
| 檔案 | 內容 | 狀態 |
|---|---|---|
| timeline.html / .template.html | 年表(水星 hero、今日のにしな、参戦濾鏡、互通) | ✅ 已實裝 |
| concerts.html / .template.html | 公演史(火星 hero、站點展開逐站章、互通) | ✅ 已實裝 |
| footprint.html / .template.html | 出演足跡(火星 hero、真日本地圖、印章、分頁) | ✅ 已實裝 |

## 🔧 資料與管線
| 檔案 | 用途 | 更新時機 |
|---|---|---|
| data/*.json | 六份資料(news/events/tours/setlists/japan/series) | 照 DATA-REFRESH-POLICY |
| inject.py | 資料→三頁注入(佔位符斷言) | 資料更新後執行 |
| og-gen.mjs + og/*.png | 三頁 OG 分享圖產生器 | 與 inject.py 一起跑 |
| watch-eplus.py | eplus 新場次哨兵(日更) | cron 部署 |
| build-japan-paths.v2.mjs | 日本地圖 topojson→像素路徑 | 幾乎不再需要 |
| DATA-REFRESH-POLICY.md | 資料更新政策(給 Claude Code) | 政策變更時 |

## 待辦(站長側)
- ROUTES 真路徑(galaxy 上站時)
- 金星/地球/木星等其餘行星頁 + hero(CONFIG 一行一顆)
- 海王星 About(含 Deep-Fold / UniPixelPlanet MIT credit)
- 公転頁(土星)、雷達導航驗收
