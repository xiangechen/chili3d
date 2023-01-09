const path = require("path");

module.exports = {
    entry: "./packages/chili-web/src/index.ts",
    module: {
        rules: [
            {
                test: /\.(js|jsx|ts|tsx)$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.wasm$/,
                type: "javascript/auto",
                loader: "file-loader",
            },
            {
                test: /\.worker\.js$/,
                use: { loader: "worker-loader", options: { fallback: false } },
            },
            {
                test: /\.css$/,
                use: [
                    "style-loader",
                    {
                        loader: "css-loader",
                        options: {
                            modules: true,
                        },
                    },
                ],
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
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "./build"),
        clean: true,
    },
    experiments: {
        topLevelAwait: true,
    },
};
