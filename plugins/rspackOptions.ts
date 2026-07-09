import { resolve } from "node:path";
import type { RspackOptions } from "@rspack/core";
import rspack from "@rspack/core";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

const __dirname = import.meta.dirname;
const rootDir = resolve(__dirname, "..");
const tsconfigPath = resolve(rootDir, "tsconfig.json");

export function commonRspackOptions(overrides?: RspackOptions): RspackOptions {
    const { entry: extraEntry, resolve: extraResolve, ...rest } = overrides ?? {};

    return {
        devtool: process.env.NODE_ENV === "production" ? false : "source-map",
        entry: {
            main: "./src/index.ts",
            ...extraEntry,
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
        },
        module: {
            parser: {
                "css/auto": {
                    namedExports: false,
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
                    },
                },
            ],
        },
        resolve: {
            extensions: [".ts", ".js", ".json", ".wasm"],
            tsConfig: {
                configFile: tsconfigPath,
                references: "auto",
            },
            ...extraResolve,
        },
        optimization: {
            avoidEntryIife: true,
            splitChunks: false,
            minimize: true,
            minimizer: [new rspack.LightningCssMinimizerRspackPlugin()],
        },
        output: {
            clean: true,
            filename: "[name].js",
            library: {
                type: "modern-module",
            },
            workerChunkLoading: "import",
        },
        plugins: [
            new TsCheckerRspackPlugin({
                typescript: {
                    configFile: tsconfigPath,
                },
            }),
            new rspack.CircularDependencyRspackPlugin({
                failOnError: true,
                exclude: /node_modules/,
            }),
        ],
        ...rest,
    };
}
