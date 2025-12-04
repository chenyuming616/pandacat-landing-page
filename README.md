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

## 部署到 Vercel

### 方法一：透過 Vercel CLI

```bash
# 安裝 Vercel CLI
npm install -g vercel

# 登入 Vercel
vercel login

# 部署
cd pandacat-landing-page
vercel --prod
```

### 方法二：透過 GitHub

1. 將此專案推送到 GitHub
2. 登入 [Vercel](https://vercel.com)
3. 點擊「Add New Project」
4. 選擇此 GitHub repository
5. 框架選擇「Other」
6. 點擊「Deploy」

### 方法三：直接拖曳上傳

1. 登入 [Vercel](https://vercel.com)
2. 將整個 `pandacat-landing-page` 資料夾拖曳到 Vercel 網站

## 部署後設定

### 1. 設定自訂網域

在 Vercel 專案設定中：
1. 前往「Settings」>「Domains」
2. 新增你的網域（如 `pandacat.tw`）
3. 依照指示設定 DNS 記錄

### 2. 更新社群連結

在 `index.html` 中搜尋並替換以下連結：
- `https://shopee.tw/pandacat` → 你的 Shopee 商店連結
- `https://www.instagram.com/pandacat` → 你的 Instagram 連結
- `https://www.threads.net/@pandacat` → 你的 Threads 連結
- `hello@pandacat.tw` → 你的聯繫 Email

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
- **SEO**：完整的 Meta tags、Open Graph、FAQ Schema
- **效能目標**：Lighthouse > 85

## 授權

© 2024 胖大喵 Pandacat. All rights reserved.
