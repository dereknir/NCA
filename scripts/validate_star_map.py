#!/usr/bin/env python3
"""
validate_star_map.py — Derek 本機跑完 e5 後的驗收腳本
檢查 schema/座標/星座分布,並抽 5 句列出語意最近鄰供目檢。
用法: python validate_star_map.py
"""
import json, sys
import numpy as np

sm = json.load(open('star_map.json', encoding='utf-8'))
pts = sm['points']
assert all(k in pts[0] for k in ('ja','zh','x','y','c','n','song')), 'schema 缺欄位'
xs = [p['x'] for p in pts]; ys = [p['y'] for p in pts]
print(f"點數 {len(pts)} | encoder={sm['meta']['encoder']} | 投影={sm['meta']['projection']}")
print(f"座標範圍 x[{min(xs):.0f},{max(xs):.0f}] y[{min(ys):.0f},{max(ys):.0f}](應約 0-1000)")
sizes = sorted((c['size'] for c in sm['clusters']), reverse=True)
print(f"星座大小分布: {sizes}(單一星座 >40% 代表分群失衡,調 --k)")
if sm['meta']['encoder'] != 'e5':
    print("⚠ 目前是佔位編碼器的輸出,勿上線")

try:
    vq = json.load(open('vectors_q8.json', encoding='utf-8'))
    V = np.asarray(vq['vectors'], dtype=np.float32) / vq['scale']
    V /= (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
    rng = np.random.default_rng(20260721)
    print("\n=== 語意鄰居目檢(應為意義相近,而非只是同字/同韻) ===")
    for i in rng.choice(len(pts), 5, replace=False):
        sims = V @ V[i]
        for rank, j in enumerate(np.argsort(-sims)[:4]):
            mark = '◆' if rank == 0 else f'  {sims[j]:.3f}'
            print(f"{mark} {pts[j]['ja']}  [{pts[j]['title']}]")
        print()
except FileNotFoundError:
    print("\n(無 vectors_q8.json,跳過鄰居目檢;e5 執行時會自動輸出)")
