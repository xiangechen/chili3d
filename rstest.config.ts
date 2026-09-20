import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json" with { type: "json" };

const configDir = import.meta.dirname;

export default defineConfig({
    exclude: ["**/cpp/**"],
    coverage: {
        exclude: ["**/wasm/lib/**", "**/test-utils/**"],
    },
    globals: true,
    // Applied to every test file: the identity-loss guard must cover them all, not just the
    // parametric ones — any package can drive a feature chain through the app.
    setupFiles: [
        resolve(configDir, "packages/core/test-utils/setup.ts"),
        resolve(configDir, "packages/parametric/test/setup.ts"),
    ],
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            plugins: [
                new DefinePlugin({
                    __APP_VERSION__: JSON.stringify(packages.version),
                    __DOCUMENT_VERSION__: JSON.stringify(packages.documentVersion),
                    __IS_PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
                }),
            ],
            module: {
                rules: [
                    // Mirror rspack.config.ts: load .wasm as an asset URL instead of a
                    // native webassembly module (which would instantiate at import time).
                    { test: /\.wasm$/, type: "asset" },
                ],
            },
        },
    },
    resolve: {
        alias: {
            "./viewGizmo": resolve(configDir, "packages/three/test/viewGizmo.ts"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
