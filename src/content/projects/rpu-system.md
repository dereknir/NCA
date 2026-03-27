---
title: "RPU 投後監控系統"
description: "金融投資組合即時監控儀表板，整合市場數據與財務模型預測"
publishDate: 2026-03-20
coverImage: "/images/projects/rpu-cover.png"
techStack: ["Python", "Streamlit", "PostgreSQL", "Flask", "JavaScript"]
featured: true
---

## 專案背景

這是我在美好金融實習期間參與開發的投資組合監控系統，用於追蹤台灣、美國、中國三地市場的投資標的表現。

## 核心功能

### 1. 投資組合總覽
- 即時計算持股市值、權重、IRR
- 動態更新市場數據（股價、PE、市值）
- 支援多幣別換算

### 2. 風險預警系統（Bell Alerts）
- 自動監控財報異常
- 法說會逐字稿分析
- 關鍵指標預警通知

### 3. Model 深度分析
- 情境分析（樂觀/合理/保守）
- 財務模型預測與回測
- 業務結構拆解

## 技術挑戰與解決方案

### 挑戰 1：多環境 API URL 配置

**問題**：Streamlit 使用 iframe 嵌入 HTML，導致相對路徑失效

**解決方案**：動態注入 API Base URL，所有 API 呼叫使用動態 URL

### 挑戰 2：複雜財務計算邏輯

**解決方案**：
- 使用 PostgreSQL VIEW 預先計算複雜指標（IRR、報酬率）
- Python 輔助函式統一管理計算邏輯
- Streamlit 頁面只負責展示，不做計算

## 開發心得

這個專案讓我學到：

1. **架構設計的重要性**：前後端分離、計算邏輯後端化，讓系統更易維護
2. **環境變數管理**：不同環境（開發/測試/生產）的配置管理
3. **團隊協作**：使用 Git Flow、Code Review、文件撰寫

## 成果展示

- 每日服務 20+ PM 使用
- 追蹤 100+ 投資標的
- 平均頁面載入時間 < 2 秒
