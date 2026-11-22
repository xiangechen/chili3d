import { resolve } from "node:path";
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";
import packages from "./package.json" with { type: "json" };

const isProduction = process.env.NODE_ENV === "production";
const configDir = import.meta.dirname;
const developmentServiceWorker = `
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith("chili3d-")).map((name) => caches.delete(name)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        await Promise.all(clients.map((client) => client.navigate(client.url)));
    })());
});
`;

export default defineConfig({
    devtool: isProduction ? false : "source-map",
    entry: {
        main: "./packages/web/src/index.ts",
    },
    experiments: {
        css: true,
    },
    devServer: {
        headers: isProduction ? {} : { "X-Chili3D-Development": "true" },
        setupMiddlewares: (middlewares, server) => {
            if (!isProduction) {
                server.app?.use("/sw.js", (_request, response) => {
                    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
                    response.end(developmentServiceWorker);
                });
            }
            return middlewares;
        },
    },
    module: {
        parser: {
            "css/auto": {
                namedExports: false,
                // Rspack 2.3 localizes dashed identifiers (custom properties) by default, so the
                // theme variables a module declares (`--border-color`, ...) land under a
                // `--chili3d-..._module_css-` name that no other file's `var(--border-color)`
                // resolves against. They are the app's theme contract, not module locals.
                dashedIdents: false,
            },
        },
        rules: [
            {
                test: /\.css$/,
                type: "css/auto",
            },
            {
                test: /\.wasm$/,
                type: "asset",
            },
            {
                test: /\.cur$/,
                type: "asset",
            },
            {
                test: /\.jpg$/,
                type: "asset",
            },
            {
                test: /\.(j|t)s$/,
                loader: "builtin:swc-loader",
                options: {
                    jsc: {
                        parser: {
                            syntax: "typescript",
                            decorators: true,
                        },
                        target: "esnext",
                    },
                    collectTypeScriptInfo: {
                        exportedEnum: isProduction,
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".js", ".json", ".wasm"],
    },
    plugins: [
        new TsCheckerRspackPlugin(),
        new rspack.CircularDependencyRspackPlugin({
            failOnError: true,
            exclude: /node_modules/,
        }),
        new rspack.CopyRspackPlugin({
            patterns: [
                {
                    from: resolve(configDir, "public"),
                    globOptions: {
                        ignore: ["**/**/index.html", "**/sw.js"],
                    },
                },
            ],
        }),
        new rspack.DefinePlugin({
            __APP_VERSION__: JSON.stringify(packages.version),
            __DOCUMENT_VERSION__: JSON.stringify(packages.documentVersion),
            __IS_PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
        }),
        new rspack.HtmlRspackPlugin({
            template: resolve(configDir, "public/index.html"),
            inject: "body",
        }),
        // The ChatGPT sign-in redirect target (packages/ai/src/chatgptAuth.ts): a static page with
        // no bundle, served at /auth/callback/. The copy rule above skips every index.html.
        new rspack.HtmlRspackPlugin({
            template: resolve(configDir, "public/auth/callback/index.html"),
            filename: "auth/callback/index.html",
            inject: false,
        }),
    ],
    devServer: {
        proxy: [
            {
                // The ChatGPT plan's API calls (packages/ai/src/chatgptAuth.ts `chatGPTApiBase`):
                // api.openai.com sends no CORS headers for a ChatGPT-token request, so the page
                // reaches it through its own origin. Mirrored by docker/nginx.conf.
                context: ["/openai/"],
                target: "https://api.openai.com",
                changeOrigin: true,
                pathRewrite: { "^/openai": "" },
                on: {
                    proxyReq: (proxyReq) => {
                        // The page's own origin and cookies are nothing OpenAI should see.
                        for (const header of ["origin", "referer", "cookie"]) proxyReq.removeHeader(header);
                    },
                    proxyRes: (proxyRes) => {
                        // `no-transform` keeps the dev server's compression from buffering the
                        // event stream, so the reply still arrives as it is written.
                        proxyRes.headers["cache-control"] = "no-cache, no-transform";
                    },
                },
            },
        ],
    },
    optimization: {
        minimizer: [
            new rspack.SwcJsMinimizerRspackPlugin({
                minimizerOptions: {
                    mangle: {
                        keep_classnames: true,
                        keep_fnames: true,
                    },
                },
            }),
            new rspack.LightningCssMinimizerRspackPlugin(),
        ],
    },
    output: {
        clean: true,
    },
    watchOptions: {
        // On the TypeScript-Go path ts-checker watches the whole rspack context (the repo
        // root); chokidar 4 opens each file with its own `fs.watch`, so the OCCT checkout
        // under cpp/build alone would exhaust the file-descriptor limit. Build/report outputs
        // take no part in the bundle.
        ignored: [/[/\\](cpp|dist|coverage|docs|types)[/\\]/],
    },
});
