const path = require("path");

module.exports = (env, arg) => {
    console.log(arg);
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
            copy: env.production
                ? {
                      patterns: [
                          {
                              from: "./public",
                          },
                      ],
                  }
                : undefined,
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
};
