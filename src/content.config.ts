import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const translationsCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/translations' }),
  schema: z.object({
    title: z.string()
      .min(1, '標題不能為空')
      .max(100, '標題不能超過 100 個字元'),
    artist: z.string()
      .min(1, '歌手名稱不能為空')
      .max(50, '歌手名稱不能超過 50 個字元'),
    album: z.string()
      .max(100, '專輯名稱不能超過 100 個字元')
      .optional(),
    albumYear: z.coerce.number()
      .int()
      .min(1900)
      .max(2100)
      .optional(),
    trackNumber: z.coerce.number()
      .int()
      .positive()
      .optional(),
    youtubeId: z.string()
      .regex(/^[a-zA-Z0-9_-]{11}$/, 'YouTube ID 格式錯誤（應為 11 個字元）')
      .optional(),
    publishDate: z.coerce.date()
      .refine(
        date => date <= new Date(),
        { message: '發布日期不能是未來日期' }
      ),
    tags: z.array(z.string())
      .min(1, '至少需要一個標籤')
      .max(10, '標籤數量不能超過 10 個')
      .refine(
        tags => tags.every(tag => tag.length > 0 && tag.length <= 20),
        { message: '每個標籤長度必須在 1-20 個字元之間' }
      ),
    originalLang: z.string()
      .regex(/^[a-z]{2}$/, '語言代碼應為兩個小寫字母（如 ja, en）')
      .default('ja'),
    coverImage: z.string()
      .url('封面圖片必須是有效的 URL')
      .or(z.string().startsWith('/', '封面圖片路徑必須以 / 開頭'))
      .optional(),
    liveShorts: z.array(
        z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'YouTube Short ID 格式錯誤（應為 11 個字元）')
      )
      .max(30, 'Shorts 數量不能超過 30 個')
      .optional(),
  }),
});

const diaryCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/diary' }),
  schema: z.object({
    title: z.string()
      .min(1, '標題不能為空')
      .max(100, '標題不能超過 100 個字元'),
    date: z.coerce.date()
      .refine(
        date => date <= new Date(),
        { message: '日記日期不能是未來日期' }
      ),
    mood: z.string()
      .max(10, '心情表情符號過長')
      .optional(),
    weather: z.string()
      .max(30, '天氣描述不能超過 30 個字元')
      .optional(),
    tags: z.array(z.string())
      .max(10, '標籤數量不能超過 10 個')
      .refine(
        tags => tags.every(tag => tag.length > 0 && tag.length <= 20),
        { message: '每個標籤長度必須在 1-20 個字元之間' }
      ),
    isPrivate: z.boolean().default(false),
  }),
});

const projectsCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string()
      .min(1, '標題不能為空')
      .max(100, '標題不能超過 100 個字元'),
    description: z.string()
      .min(10, '描述至少需要 10 個字元')
      .max(500, '描述不能超過 500 個字元'),
    publishDate: z.coerce.date()
      .refine(
        date => date <= new Date(),
        { message: '發布日期不能是未來日期' }
      ),
    coverImage: z.string()
      .url('封面圖片必須是有效的 URL')
      .or(z.string().startsWith('/', '封面圖片路徑必須以 / 開頭'))
      .optional(),
    demoUrl: z.string()
      .url('Demo URL 必須是有效的網址')
      .optional(),
    githubUrl: z.string()
      .url('GitHub URL 必須是有效的網址')
      .refine(
        url => !url || url.includes('github.com'),
        { message: 'GitHub URL 必須包含 github.com' }
      )
      .optional(),
    techStack: z.array(z.string())
      .min(1, '至少需要一個技術標籤')
      .max(15, '技術標籤數量不能超過 15 個')
      .refine(
        tags => tags.every(tag => tag.length > 0 && tag.length <= 30),
        { message: '每個技術標籤長度必須在 1-30 個字元之間' }
      ),
    featured: z.boolean().default(false),
  }),
});

export const collections = {
  translations: translationsCollection,
  diary: diaryCollection,
  projects: projectsCollection,
};
