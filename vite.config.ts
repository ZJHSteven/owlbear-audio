import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Owlbear Rodeo 在开发时会从 https://www.owlbear.rodeo 嵌入本地 Vite 页面。
 * 因此开发服务器需要明确允许 Owlbear 来源跨域读取 manifest 和页面资源。
 *
 * 这里没有额外后端：Vite 仅在开发阶段充当静态文件服务器。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  },
});
