import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";

export default defineConfig({
    exclude: ["**/cpp/**"],
    globals: true,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            plugins: [
                new DefinePlugin({
                    __IS_PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
                }),
            ],
        },
    },
    resolve: {
        alias: {
            "./viewGizmo": "./packages/chili-three/test/viewGizmo.ts",
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
