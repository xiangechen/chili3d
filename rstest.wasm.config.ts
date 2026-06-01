import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json";

// Integration tests that load the REAL OCCT WebAssembly kernel and exercise
// geometry. They run in a pure Node environment (not happy-dom): the Emscripten
// module detects Node and loads the .wasm from the filesystem. Under happy-dom,
// `window` exists and Emscripten takes the browser path (fetch), which fails.
//
// Test files must be named `*.wasm.test.ts`; the default `npm test` config
// excludes them so they never run under happy-dom.
export default defineConfig({
    name: "wasm",
    include: ["**/*.wasm.test.ts"],
    exclude: ["**/cpp/**", "**/node_modules/**"],
    globals: true,
    testEnvironment: "node",
    setupFiles: ["./rstest-setup.ts"],
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
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
