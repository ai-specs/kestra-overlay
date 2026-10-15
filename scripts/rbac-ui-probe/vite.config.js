import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({plugins: [vue()], build: {outDir: "dist", emptyOutDir: true, rollupOptions: {input: {main: "index.html", language: "language.html"}}}, server: {host: "127.0.0.1", port: 5197, strictPort: true}});
