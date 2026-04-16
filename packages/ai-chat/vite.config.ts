import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the chat iframe app into /public/chat so Rspack's CopyRspackPlugin
// ships it alongside the main bundle and it's reachable at /chat/ in dev + prod.
export default defineConfig({
    plugins: [react()],
    base: "/chat/",
    build: {
        outDir: resolve(__dirname, "../../public/chat"),
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            output: {
                entryFileNames: "assets/[name]-[hash].js",
                chunkFileNames: "assets/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
    },
});
