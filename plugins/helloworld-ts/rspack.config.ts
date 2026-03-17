import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

export default defineConfig({
    devtool: false,
    entry: {
        main: "./src/index.ts",
        module1: "./src/modules/module1.ts",
    },
    externals: [
        {
            "@chili3d/core": "Chili3dCore",
            "@chili3d/element": "Chili3dElement",
        },
    ],
    externalsType: "assign",
    experiments: {
        css: true,
        outputModule: true,
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
        alias: {
            module1: "./src/modules/module1.ts",
        },
    },
    optimization: {
        concatenateModules: true,
        avoidEntryIife: true,
        splitChunks: false,
        minimize: true,
        minimizer: [new rspack.LightningCssMinimizerRspackPlugin()],
    },
    output: {
        clean: true,
        filename: "[name].js",
        module: true,
        chunkFormat: "module",
        library: {
            type: "modern-module",
        },
        chunkLoading: "import",
        workerChunkLoading: "import",
    },
    plugins: [
        new TsCheckerRspackPlugin(),
        new rspack.CircularDependencyRspackPlugin({
            failOnError: true,
            exclude: /node_modules/,
        }),
    ],
});
