const path = require("path");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

module.exports = (env, arg) => {
    return {
        entry: {
            main: "./packages/chili-web/src/index.ts",
        },
        module: {
            rules: [
                {
                    test: /\.wasm$/,
                    type: "asset",
                },
            ],
        },
        builtins: {
            copy: {
                patterns: [
                    {
                        from: "./public",
                    },
                ],
            },
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
        plugins: [new ForkTsCheckerWebpackPlugin()],
        output: {
            filename: "bundle.js",
            path: path.resolve(__dirname, "build"),
        },
    };
};
