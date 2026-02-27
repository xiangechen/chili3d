import { defineConfig } from "@rspack/cli";

export default defineConfig({
    devtool: false,
    entry: {
        main: "./src/index.ts",
    },
    externals: {
        "chili-api": "ChiliAPI",
    },
    experiments: {
        css: true,
    },
    module: {
        parser: {
            "css/auto": {
                namedExports: false,
            },
        },
        rules: [
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
                },
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".js", ".json", ".wasm"],
    },
    optimization: {
        minimize: true,
        splitChunks: false,
    },
    output: {
        clean: true,
        filename: "extension.js",
        module: true,
        library: {
            type: "modern-module",
        },
    },
});
