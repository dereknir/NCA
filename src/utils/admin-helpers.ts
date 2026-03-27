/**
 * Admin 頁面輔助函數
 * 將 admin 頁面的邏輯模塊化，提高代碼可維護性
 */

/**
 * GitHub API 配置
 */
export const GITHUB_API_CONFIG = {
  baseUrl: 'https://api.github.com',
  headers: {
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  },
  tokenExpiryHours: 2,
} as const;

/**
 * 集合配置型別
 */
export interface CollectionConfig {
  title: string;
  path: string;
  fields: FieldConfig[];
}

export interface FieldConfig {
  name: string;
  label: string;
  type: 'text' | 'date' | 'tags' | 'checkbox';
  required: boolean;
  help?: string;
}

/**
 * Admin 憑證管理
 */
export class AdminCredentials {
  private static readonly STORAGE_KEY = 'admin-creds';

  static save(token: string, repo: string, branch: string): void {
    const expiry = Date.now() + (GITHUB_API_CONFIG.tokenExpiryHours * 60 * 60 * 1000);
    sessionStorage.setItem(
      this.STORAGE_KEY,
      JSON.stringify({ token, repo, branch, expiry })
    );
  }

  static load(): { token: string; repo: string; branch: string } | null {
    try {
      const saved = sessionStorage.getItem(this.STORAGE_KEY);
      if (!saved) return null;

      const creds = JSON.parse(saved);

      // 檢查是否過期
      if (Date.now() >= creds.expiry) {
        this.clear();
        return null;
      }

      return creds;
    } catch (e) {
      this.clear();
      return null;
    }
  }

  static clear(): void {
    sessionStorage.removeItem(this.STORAGE_KEY);
  }
}

/**
 * Token 驗證器
 */
export class TokenValidator {
  static validateFormat(token: string): boolean {
    return token.startsWith('ghp_') || token.startsWith('github_pat_');
  }

  static validateRepoFormat(repo: string): boolean {
    const parts = repo.split('/');
    return parts.length === 2 && parts.every(p => p.length > 0);
  }
}

/**
 * Frontmatter 解析器
 */
export class FrontmatterParser {
  /**
   * 從 Markdown 內容中提取 frontmatter
   */
  static extract(content: string): { frontmatter: string; body: string } | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    return {
      frontmatter: match[1],
      body: match[2].trim(),
    };
  }

  /**
   * 解析 frontmatter 中的單一欄位
   */
  static parseField(frontmatter: string, fieldName: string): string | null {
    const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
    const match = frontmatter.match(regex);
    if (!match) return null;

    return match[1].trim().replace(/^["']|["']$/g, '');
  }

  /**
   * 構建 frontmatter
   */
  static build(fields: Record<string, any>): string {
    let frontmatter = '---\n';

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;

      if (typeof value === 'boolean') {
        frontmatter += `${key}: ${value}\n`;
      } else if (Array.isArray(value)) {
        frontmatter += `${key}: [${value.map(v => `"${v}"`).join(', ')}]\n`;
      } else if (typeof value === 'string') {
        // 如果是日期格式，不加引號
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          frontmatter += `${key}: ${value}\n`;
        } else {
          frontmatter += `${key}: "${value}"\n`;
        }
      } else {
        frontmatter += `${key}: ${value}\n`;
      }
    }

    frontmatter += '---\n\n';
    return frontmatter;
  }
}

/**
 * 檔案名稱驗證器
 */
export class FilenameValidator {
  private static readonly VALID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  static validate(filename: string): boolean {
    // 移除副檔名
    const nameWithoutExt = filename.replace(/\.(md|mdx)$/, '');
    return this.VALID_PATTERN.test(nameWithoutExt);
  }

  static sanitize(filename: string): string {
    // 確保有正確的副檔名
    if (!filename.endsWith('.md') && !filename.endsWith('.mdx')) {
      return filename + '.md';
    }
    return filename;
  }
}

/**
 * Base64 編碼器（處理 UTF-8）
 */
export class Base64Encoder {
  static encode(content: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(content)));
  }

  static decode(encoded: string): string {
    const content = atob(encoded.replace(/\n/g, ''));
    return new TextDecoder().decode(
      Uint8Array.from(content, c => c.charCodeAt(0))
    );
  }
}
