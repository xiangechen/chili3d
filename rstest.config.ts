import { defineConfig } from "@rstest/core";

export default defineConfig({
    globals: true,
    testEnvironment: "happy-dom",
    exclude: ["**/cpp/**"],
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
