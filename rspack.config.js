const path = require("path");

module.exports = {
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
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "build"),
    },
};
