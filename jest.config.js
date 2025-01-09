module.exports = {
    extensionsToTreatAsEsm: [".ts"],
    preset: "ts-jest/presets/default-esm",
    testRegex: "packages/.*/test/(.+)\\.test\\.(js|ts)$",
    testEnvironment: "jsdom",
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    moduleNameMapper: {
        threeRenderBuilder: "<rootDir>/packages/chili-three/test/threeRenderBuilder.ts",
        "camera-controls": "<rootDir>/packages/chili-three/test/cameraControls.ts",
    },
};
