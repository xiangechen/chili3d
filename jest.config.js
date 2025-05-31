module.exports = {
    extensionsToTreatAsEsm: [".ts"],
    preset: "ts-jest/presets/default-esm",
    testRegex: "packages/.*/test/(.+)\\.test\\.(js|ts)$",
    testEnvironment: "jsdom",
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    moduleNameMapper: {
        threeRenderBuilder: "<rootDir>/packages/chili-three/test/threeRenderBuilder.ts",
        "\\.(css|less)$": "<rootDir>/packages/chili-controls/test/styleMock.js",
    },
};
