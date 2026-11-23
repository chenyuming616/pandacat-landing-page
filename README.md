# 胖大喵 Pandacat Landing Page

優質寵物用品選物店的品牌 Landing Page。

## 專案結構

```
pandacat-landing-page/
├── index.html          # 主頁面
├── style.css           # 樣式表
├── sitemap.xml         # 網站地圖
├── robots.txt          # 爬蟲規則
├── README.md           # 本文件
└── assets/
    ├── logo.png        # 品牌 Logo
    ├── favicon.ico     # 網站圖示
    └── og-image.png    # Open Graph 分享圖
```

## Blog 維護與部署

發文、預覽、檢查請用 [Blog 發文規範](docs/blog-standard.md)。新稿用 Markdown，網站保持靜態 HTML/CSS。

`vercel.json` 設定 `npm run blog:stage` 為建置指令、`dist` 為輸出目錄。GitHub 串接部署時，請先在預覽確認 Vercel 讀取的是這份設定，以及 GitHub 的文章檢查有被設為合併門檻。舊專案的正式分支、權限和設定不以 repo 推定。

若要手動部署，先執行 `npm ci --ignore-scripts`、`npm run blog:test`、`npm run blog:stage`，只交付通過檢查的 `dist/`。**不要上傳整個 repo**，因為 repo 根目錄有原稿、測試和設定，並非公開輸出。

## 部署後設定

### 1. 設定自訂網域

在 Vercel 專案設定中：
1. 前往「Settings」>「Domains」
2. 新增你的網域（如 `pandacat.tw`）
3. 依照指示設定 DNS 記錄

### 2. 更新社群連結

在 `index.html` 中搜尋並替換以下連結：
- `https://www.instagram.com/pandacat` → 你的 Instagram 連結
- `https://www.threads.net/@pandacat` → 你的 Threads 連結
- `hello@pandacat.tw` → 你的聯繫 Email

蝦皮追蹤連結統一管理於 [`scripts/shopee-links.json`](scripts/shopee-links.json)。請保留提供的完整網址；修改後執行 `npm run blog:build`、`npm run blog:check`。文章內的用法見 [Blog 發布規範](docs/blog-standard.md)。

### 3. 設定 Google Search Console

1. 前往 [Google Search Console](https://search.google.com/search-console)
2. 新增資源，輸入你的網址
3. 使用 HTML 標記驗證方式
4. 複製驗證碼，貼到 `index.html` 的 `<head>` 區段

### 4. 設定 Google Analytics（GA4）

在 `index.html` 的 `</head>` 前加入：

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

將 `G-XXXXXXXXXX` 替換為你的 GA4 測量 ID。

## 技術規格

- **輸出格式**：純靜態 HTML/CSS
- **響應式設計**：Mobile First
- **SEO**：Meta tags、Open Graph、文章結構化資料
- **效能目標**：Lighthouse > 85

## 授權

© 2024 胖大喵 Pandacat. All rights reserved.
