import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json";

export default defineConfig({
    exclude: ["**/cpp/**"],
    globals: true,
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
        },
    },
    resolve: {
        alias: {
            "./viewGizmo": "./packages/three/test/viewGizmo.ts",
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
