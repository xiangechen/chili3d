const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");
const path = require("path");

module.exports = merge(common, {
    mode: "development",
    devtool: "eval-source-map",
    devServer: {
        static: [
            {
                directory: path.join(__dirname, "public"),
            },
            {
                directory: path.join(__dirname, "dist"),
            },
        ],
        hot: true,
        compress: true,
    },
});
