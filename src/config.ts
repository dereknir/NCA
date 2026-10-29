import siteNav from './data/site-nav.json';

/**
 * 網站配置檔案 - 集中管理所有配置
 */

export const SITE_CONFIG = {
  // 網站基本資訊
  title: "Derek's Site",
  description: "Derek 的個人網站 - 日文歌翻譯、日記、程式作品",
  author: "Derek Ni",
  url: "https://derekni.com",

  // 語言設定
  lang: "zh-TW",
  locale: "zh_TW",

  // 預設圖片
  defaultOGImage: "/og/default.png",   // scripts/og-default.mjs 產生 (1200×630 像素風)

  // 社交媒體連結
  social: {
    github: "https://github.com/dereknir",
    email: "dereknir6409@gmail.com",
  },

  // 內容設定
  content: {
    // 首頁顯示數量
    recentTranslations: 3,
    recentDiary: 3,
    featuredProjects: 3,

    // 分頁設定
    itemsPerPage: 12,
  },

  // SEO 設定
  seo: {
    twitterCard: "summary_large_image",
    ogType: "website",
  },

  // 日期格式選項
  dateFormats: {
    short: { year: 'numeric', month: 'numeric', day: 'numeric' } as Intl.DateTimeFormatOptions,
    long: { year: 'numeric', month: 'long', day: 'numeric' } as Intl.DateTimeFormatOptions,
    full: {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    } as Intl.DateTimeFormatOptions,
  },
} as const;

/**
 * 導航選單配置 — 來源是 src/data/site-nav.json (靜態頁的頁首也讀同一份, 經 /site-index.json)
 */
export const NAV_GROUPS = siteNav.groups;
export const PLANETS = siteNav.planets as Record<string, Planet>;
export const NAVIGATION = NAV_GROUPS.flatMap(g => g.items.map(({ name, href }) => ({ name, href })));

export interface Planet {
  ja: string;
  en: string;
  kind: string;
  palette: number[][];
}

/**
 * 內容集合路徑配置
 */
export const CONTENT_PATHS = {
  translations: "src/content/translations",
  diary: "src/content/diary",
  projects: "src/content/projects",
} as const;

/**
 * 主題顏色配置
 */
export const THEME_COLORS = {
  primary: "#2563eb",
  secondary: "#64748b",
  accent: "#8b5cf6",
  success: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444",
} as const;
