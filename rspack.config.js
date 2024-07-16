const rspack = require("@rspack/core");
const { defineConfig } = require("@rspack/cli");
const path = require("path");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const config = defineConfig({
    entry: {
        main: "./packages/chili-web/src/index.ts",
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
        extensions: [".tsx", ".ts", ".js"],
        fallback: {
            fs: false,
            perf_hooks: false,
            os: false,
            crypto: false,
            stream: false,
            path: false,
        },
    },
    plugins: [
        new ForkTsCheckerWebpackPlugin(),
        new rspack.CopyRspackPlugin({
            patterns: [
                {
                    from: "./public",
                    globOptions: {
                        ignore: ["**/**/index.html"],
                    },
                },
            ],
        }),
        new rspack.HtmlRspackPlugin({
            template: "./public/index.html",
            inject: "body",
        }),
    ],
    output: {
        filename: "[contenthash].bundle.js",
        path: path.resolve(__dirname, "build"),
    },
    optimization: {
        minimizer: [
            new rspack.SwcJsMinimizerRspackPlugin({
                mangle: false,
            }),
            new rspack.SwcCssMinimizerRspackPlugin(),
        ],
    },
});

module.exports = config;
