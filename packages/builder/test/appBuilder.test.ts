// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { AppBuilder } from "../src/appBuilder";
import { DefaultDataExchange } from "../src/defaultDataExchange";

// IMPORTANT: AppBuilder.createApp() calls new Application() which calls
// setCurrentApplication() — a module-level singleton that throws if called more
// than once. All tests that call createApp()/build() share ONE call at the end.

describe("AppBuilder", () => {
    let originalLocalStorage: Storage;

    beforeAll(() => {
        originalLocalStorage = globalThis.localStorage;
        Object.defineProperty(globalThis, "localStorage", {
            value: {
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {},
                clear: () => {},
                key: () => null,
                get length() {
                    return 0;
                },
            },
            configurable: true,
            writable: true,
        });
    });

    afterAll(() => {
        Object.defineProperty(globalThis, "localStorage", {
            value: originalLocalStorage,
            configurable: true,
            writable: true,
        });
    });

    describe("constructor", () => {
        test("should create an AppBuilder instance", () => {
            const builder = new AppBuilder();
            expect(builder).toBeDefined();
            expect(builder instanceof AppBuilder).toBe(true);
        });

        test("should initialize _inits with i18n and ensureAPI entries", () => {
            const builder = new AppBuilder();
            const inits = (builder as any)._inits as (() => Promise<void>)[];
            expect(inits.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe("initConfig", () => {
        test("should return this for chaining", () => {
            const builder = new AppBuilder();
            const result = (builder as any).initConfig();
            expect(result).toBe(builder);
        });
    });

    describe("initDataExchange", () => {
        test("should return a DefaultDataExchange instance", () => {
            const builder = new AppBuilder();
            const exchange = builder.initDataExchange();
            expect(exchange).toBeDefined();
            expect(exchange instanceof DefaultDataExchange).toBe(true);
        });
    });

    describe("getServices", () => {
        test("should return an array with CommandService and HotkeyService", () => {
            const builder = new AppBuilder();
            const services = (builder as any).getServices();
            expect(Array.isArray(services)).toBe(true);
            expect(services.length).toBe(2);
        });
    });

    describe("ensureNecessary", () => {
        test("should throw when shapeProvider is undefined", () => {
            const builder = new AppBuilder();
            (builder as any)._visualFactory = {};
            (builder as any)._storage = {};
            expect(() => (builder as any).ensureNecessary()).toThrow("ShapeProvider not set");
        });

        test("should throw when visualFactory is undefined", () => {
            const builder = new AppBuilder();
            (builder as any)._shapeProvider = {};
            (builder as any)._storage = {};
            expect(() => (builder as any).ensureNecessary()).toThrow("VisualFactory not set");
        });

        test("should throw when storage is undefined", () => {
            const builder = new AppBuilder();
            (builder as any)._shapeProvider = {};
            (builder as any)._visualFactory = {};
            expect(() => (builder as any).ensureNecessary()).toThrow("storage has not been initialized");
        });

        test("should not throw when all dependencies are set", () => {
            const builder = new AppBuilder();
            (builder as any)._shapeProvider = {};
            (builder as any)._visualFactory = {};
            (builder as any)._storage = {};
            expect(() => (builder as any).ensureNecessary()).not.toThrow();
        });
    });

    describe("fluent API", () => {
        test("useIndexedDB should return this and push init function", () => {
            const builder = new AppBuilder();
            const before = (builder as any)._inits.length;
            const result = builder.useIndexedDB();
            expect(result).toBe(builder);
            expect((builder as any)._inits.length).toBe(before + 1);
        });

        test("useWasmOcc should return this and push init function", () => {
            const builder = new AppBuilder();
            const before = (builder as any)._inits.length;
            const result = builder.useWasmOcc();
            expect(result).toBe(builder);
            expect((builder as any)._inits.length).toBe(before + 1);
        });

        test("useThree should return this and push init function", () => {
            const builder = new AppBuilder();
            const before = (builder as any)._inits.length;
            const result = builder.useThree();
            expect(result).toBe(builder);
            expect((builder as any)._inits.length).toBe(before + 1);
        });

        test("useUI should return this and push init function", () => {
            const builder = new AppBuilder();
            const before = (builder as any)._inits.length;
            const result = builder.useUI();
            expect(result).toBe(builder);
            expect((builder as any)._inits.length).toBe(before + 1);
        });

        test("full fluent chain should accumulate 4 additional init functions", () => {
            const builder = new AppBuilder();
            const base = (builder as any)._inits.length;
            builder.useIndexedDB().useWasmOcc().useThree().useUI();
            expect((builder as any)._inits.length).toBe(base + 4);
        });
    });

    describe("getRibbonTabs", () => {
        test("should return default ribbon tabs", async () => {
            const builder = new AppBuilder();
            const tabs = await builder.getRibbonTabs();
            expect(Array.isArray(tabs)).toBe(true);
            expect(tabs.length).toBeGreaterThan(0);
            expect(tabs[0].tabName).toBeDefined();
        });
    });

    // ===================================================================
    // CAUTION: createApp() sets the global Application singleton.
    // Only ONE call is allowed — all assertions share the same builder.
    // ===================================================================
    describe("createApp (singleton — single call)", () => {
        test("should create an Application with all expected properties", () => {
            const builder = new AppBuilder();
            const mockStorage = { name: "mockStorage" };
            const mockShapeProvider = { name: "mockShapeProvider" };
            const mockVisualFactory = { name: "mockVisualFactory" };
            const mockWindow = {
                name: "mockWindow",
                addEventListener: rs.fn(),
                removeEventListener: rs.fn(),
            };
            (builder as any)._storage = mockStorage;
            (builder as any)._shapeProvider = mockShapeProvider;
            (builder as any)._visualFactory = mockVisualFactory;
            (builder as any)._window = mockWindow;

            const app = builder.createApp();

            expect(app).toBeDefined();
            expect(app.storage).toBe(mockStorage);
            expect(app.shapeProvider).toBe(mockShapeProvider);
            expect(app.visualFactory).toBe(mockVisualFactory);
            expect(app.mainWindow).toBe(mockWindow);
            expect(app.dataExchange).toBeDefined();
            expect(app.dataExchange instanceof DefaultDataExchange).toBe(true);
            expect(Array.isArray(app.services)).toBe(true);
        });
    });

    describe("loadDefaultPlugins (protected)", () => {
        test("should not throw when fetch returns non-ok response", async () => {
            const builder = new AppBuilder();
            const mockFetch = rs.fn(() => Promise.resolve({ ok: false } as Response));
            const originalFetch = globalThis.fetch;
            globalThis.fetch = mockFetch as any;

            const mockApp = { pluginManager: { loadFromUrl: rs.fn() } };
            await expect((builder as any).loadDefaultPlugins(mockApp)).resolves.toBeUndefined();

            globalThis.fetch = originalFetch;
        });

        test("should handle fetch error gracefully", async () => {
            const builder = new AppBuilder();
            const mockFetch = rs.fn(() => Promise.reject(new Error("network error")));
            const originalFetch = globalThis.fetch;
            globalThis.fetch = mockFetch as any;

            const mockApp = { pluginManager: { loadFromUrl: rs.fn() } };
            // Should not throw — catch block swallows errors
            await expect((builder as any).loadDefaultPlugins(mockApp)).resolves.toBeUndefined();

            globalThis.fetch = originalFetch;
        });
    });

    describe("initDataExchange", () => {
        test("should return a new DefaultDataExchange each call", () => {
            const builder = new AppBuilder();
            const d1 = builder.initDataExchange();
            const d2 = builder.initDataExchange();
            // Two separate instances
            expect(d1).not.toBe(d2);
        });
    });

    describe("getServices", () => {
        test("services array should be length 2", () => {
            const builder = new AppBuilder();
            const services = (builder as any).getServices();
            expect(services.length).toBe(2);
        });
    });
});
