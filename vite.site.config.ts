import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 官网独立构建配置。
 *
 * 为什么不复用根 vite.config.ts 的 rollupOptions.input 多入口：
 * base / publicDir / outDir 都是**全局**配置，无法按入口区分。应用产物必须是
 * base:'./'（Electron 与 Node 静态兜底依赖相对路径），官网若继承同一 base，
 * 它在根路径下的资产会解析成 /assets/*，与应用 bundle 抢占同一个 URL 前缀。
 * 因此官网必须拥有自己的 root、base 与 outDir，两者物理隔离。
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
/**
 * 桌面版下载链接与站点规范地址由部署方在构建期注入：
 *   VITE_DOWNLOAD_URL=https://…/WarpWeft-Setup.exe  npm run build:site
 *   VITE_SITE_ORIGIN=https://warpweft.example.edu   npm run build:site
 * 未注入时官网不显示下载按钮、不输出 canonical，避免出现指向不存在的链接。
 */
const downloadUrl = String(process.env.VITE_DOWNLOAD_URL ?? '').trim();
const siteOrigin = String(process.env.VITE_SITE_ORIGIN ?? '').trim().replace(/\/+$/, '');
if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) {
  throw new Error('VITE_DOWNLOAD_URL 必须是绝对 http(s) 地址，当前：' + downloadUrl);
}
if (siteOrigin && !/^https?:\/\//i.test(siteOrigin)) {
  throw new Error('VITE_SITE_ORIGIN 必须是绝对 http(s) 地址，当前：' + siteOrigin);
}
const siteRoot = here('./website');
const repoRoot = here('.');

export default defineConfig({
  root: siteRoot,
  // ★ 绝对 base '/site/' 是本方案的硬约束，禁止改回 './'：
  //   官网资产落在 /site/assets/*，应用资产落在 /assets/* 与 /app/assets/*，
  //   URL 前缀互斥，Nginx 才能无歧义地分流。
  base: '/site/',
  publicDir: here('./website/public'),
  plugins: [react()],
  // 注入官网可读取的部署期配置（未注入时为空串，官网据此隐藏入口）。
  define: {
    __SITE_DOWNLOAD_URL__: JSON.stringify(downloadUrl),
    __SITE_ORIGIN__: JSON.stringify(siteOrigin),
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    // 允许 dev server 读取 root 之外的文件（官网复用 apps/renderer/src 的部分模块）
    fs: { allow: [repoRoot], strict: false },
  },
  build: {
    outDir: here('./dist/site'),
    // outDir 在 root 之外，必须显式声明
    emptyOutDir: true,
    rollupOptions: {
      input: here('./website/index.html'),
      output: {
        entryFileNames: 'assets/site-[hash].js',
        chunkFileNames: 'assets/site-[hash].js',
        assetFileNames: 'assets/site-[hash][extname]',
      },
    },
  },
});
