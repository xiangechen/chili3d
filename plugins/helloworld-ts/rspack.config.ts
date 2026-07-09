import { defineConfig } from "@rspack/cli";
import { commonRspackOptions } from "../rspackOptions";

export default defineConfig(
    commonRspackOptions({
        entry: {
            module1: "./src/modules/module1.ts",
        },
        resolve: {
            alias: {
                module1: "./src/modules/module1.ts",
            },
        },
    }),
);
