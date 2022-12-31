const { merge } = require("webpack-merge");
const CopyPlugin = require("copy-webpack-plugin");
const common = require("./webpack.common.js");

module.exports = merge(common, {
    mode: "production",
    performance: {
        hints: false,
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: "public" }],
        }),
    ],
});
