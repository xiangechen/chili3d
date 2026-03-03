// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectSnapType } from "../src";
import {
    Config,
    DefaultDarkEdgeColor,
    DefaultLightEdgeColor,
    VisualConfig,
    VisualItemConfig,
} from "../src/config";
import { mockLocalStorage } from "./localStorageMock";

describe("VisualItemConfig", () => {
    let config: VisualItemConfig;

    beforeEach(() => {
        config = new VisualItemConfig();
    });

    test("should get default edge color", () => {
        expect(config.defaultEdgeColor).toBe(DefaultLightEdgeColor);
    });

    test("should set default edge color", () => {
        config.defaultEdgeColor = 0x123456;
        expect(config.defaultEdgeColor).toBe(0x123456);
    });

    test("should apply light theme", () => {
        config.applyTheme("light");
        expect(config.defaultEdgeColor).toBe(DefaultLightEdgeColor);
    });

    test("should apply dark theme", () => {
        config.applyTheme("dark");
        expect(config.defaultEdgeColor).toBe(DefaultDarkEdgeColor);
    });
});

describe("VisualConfig", () => {
    test("should be a singleton instance", () => {
        expect(VisualConfig).toBeInstanceOf(VisualItemConfig);
    });
});

describe("Config", () => {
    let localStorageMock: any;

    beforeEach(() => {
        localStorageMock = mockLocalStorage();

        Object.defineProperty(global, "matchMedia", {
            value: (query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => {},
            }),
            writable: true,
        });
    });

    describe("instance", () => {
        test("should return singleton instance", () => {
            const instance1 = Config.instance;
            const instance2 = Config.instance;
            expect(instance1).toBe(instance2);
        });
    });

    describe("snapType", () => {
        test("should have default snap type", () => {
            const snapType = Config.instance.snapType;
            expect(snapType).toBeDefined();
            expect(typeof snapType).toBe("number");
        });

        test("should set snap type", () => {
            Config.instance.snapType = ObjectSnapType.endPoint;
            expect(Config.instance.snapType).toBe(ObjectSnapType.endPoint);
        });
    });

    describe("enableSnapTracking", () => {
        test("should set enable snap tracking", () => {
            Config.instance.enableSnapTracking = false;
            expect(Config.instance.enableSnapTracking).toBe(false);
        });
    });

    describe("enableSnap", () => {
        test("should have default value", () => {
            expect(Config.instance.enableSnap).toBe(true);
        });

        test("should set enable snap", () => {
            Config.instance.enableSnap = false;
            expect(Config.instance.enableSnap).toBe(false);
        });
    });

    describe("dynamicWorkplane", () => {
        test("should set dynamic workplane", () => {
            Config.instance.dynamicWorkplane = false;
            expect(Config.instance.dynamicWorkplane).toBe(false);
        });
    });

    describe("language", () => {
        test("should have default value", () => {
            expect(Config.instance.language).toBeDefined();
            expect(typeof Config.instance.language).toBe("string");
        });

        test("should set language", () => {
            Config.instance.language = "zh-CN";
            expect(Config.instance.language).toBe("zh-CN");
        });
    });

    describe("navigation3D", () => {
        test("should set navigation 3D", () => {
            Config.instance.navigation3D = "Custom" as any;
            expect(Config.instance.navigation3D).toBe("Custom");
        });
    });

    describe("themeMode", () => {
        test("should set light theme mode", () => {
            Config.instance.themeMode = "light";
            expect(Config.instance.themeMode).toBe("light");
        });

        test("should set dark theme mode", () => {
            Config.instance.themeMode = "dark";
            expect(Config.instance.themeMode).toBe("dark");
        });

        test("should set system theme mode", () => {
            (window as any).matchMedia = () => {
                return {
                    matches: true,
                };
            };
            Config.instance.themeMode = "system";
            expect(Config.instance.themeMode).toBe("system");
            expect(VisualConfig.defaultEdgeColor).toBe(DefaultDarkEdgeColor);

            (window as any).matchMedia = () => {
                return {
                    matches: false,
                };
            };
            Config.instance.themeMode = "light";
            Config.instance.themeMode = "system";
            expect(VisualConfig.defaultEdgeColor).toBe(DefaultLightEdgeColor);
        });
    });

    describe("storageKey", () => {
        test("should have default storage key", () => {
            expect(Config.instance.storageKey).toBe("config");
        });

        test("should set storage key via init", () => {
            Config.instance.init("customKey");
            expect(Config.instance.storageKey).toBe("customKey");
            Config.instance.init("config");
        });
    });

    describe("readFromStorage", () => {
        test("should call setPrivateValue for each property", () => {
            Config.instance.init("testRead");
            const testData = {
                language: "en-US",
                navigation3D: "TestNav",
            };
            localStorageMock["chili3d.app.testRead"] = JSON.stringify(testData);

            Config.instance.readFromStorage();
            expect(Config.instance.language).toBe("en-US");
            expect(Config.instance.navigation3D).toBe("TestNav");
            Config.instance.init("config");
        });

        test("should handle empty storage", () => {
            Config.instance.init("config");
            localStorageMock["chili3d.app.config"] = "{}";

            Config.instance.readFromStorage();
            expect(Config.instance.language).toBeDefined();
        });
    });

    describe("saveToStorage", () => {
        test("should call ObjectStorage.setValue", () => {
            Config.instance.init("testSave");
            Config.instance.language = "fr-FR";

            Config.instance.saveToStorage();

            const stored = localStorageMock["chili3d.app.testSave"];
            expect(stored).toBeDefined();
            const parsed = JSON.parse(stored);
            expect(parsed.language).toBe("fr-FR");
            Config.instance.init("config");
        });
    });
});
