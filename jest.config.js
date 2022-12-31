module.exports = {
    extensionsToTreatAsEsm: [".ts"],
    preset: "ts-jest/presets/default-esm",
    testRegex: "packages/.*/test/(.+)\\.test\\.(js|ts)$",
    transform: {
        "^.+\\.ts$": ["ts-jest", { useESM: true }],
    },
    testEnvironment: "jsdom",
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    moduleNameMapper: {
        "\\.(css|less)$": "identity-obj-proxy",
    },
};
