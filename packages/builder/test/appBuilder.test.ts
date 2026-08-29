// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication, IWindow } from "@chili3d/core";
import { mockLocalStorage } from "@chili3d/core/test-utils";
import { ThreeVisulFactory } from "@chili3d/three";
import { MainWindow } from "@chili3d/ui";
import { OccShapeProvider } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { AppBuilder } from "../src/appBuilder";
import { DefaultDataExchange } from "../src/defaultDataExchange";
import { DefaultRibbon } from "../src/ribbon";

// IMPORTANT: AppBuilder.createApp() calls new Application() which calls
// setCurrentApplication() — a module-level singleton that throws if called more
// than once. All tests that call createApp()/build() share ONE call at the end.

// The use*() inits dynamically import the feature packages; mock them so the
// assembly tests can run without wasm binaries, WebGL, or the real UI.
const wasmMock = rs.hoisted(() => ({ initWasmCalls: 0 }));
const uiMock = rs.hoisted(() => ({ mainWindowArgs: [] as unknown[][] }));

rs.mock("@chili3d/wasm", () => ({
    initWasm: async () => {
        wasmMock.initWasmCalls++;
    },
    OccShapeProvider: class OccShapeProvider {},
}));

rs.mock("@chili3d/three", () => ({
    ThreeVisulFactory: class ThreeVisulFactory {
        constructor(readonly handler: unknown) {}
    },
}));

rs.mock("@chili3d/ui", () => ({
    MainWindow: class MainWindow {
        constructor(...args: unknown[]) {
            uiMock.mainWindowArgs.push(args);
        }
    },
}));

describe("AppBuilder", () => {
    beforeEach(() => {
        mockLocalStorage();
    });

    afterEach(() => {
        Object.defineProperty(global, "localStorage", {
            value: undefined,
            writable: true,
        });
    });

    describe("constructor", () => {
        test("should create an AppBuilder instance", () => {
            const builder = new AppBuilder();
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
            expect(exchange instanceof DefaultDataExchange).toBe(true);
        });

        test("should return a new DefaultDataExchange each call", () => {
            const builder = new AppBuilder();
            const d1 = builder.initDataExchange();
            const d2 = builder.initDataExchange();
            // Two separate instances
            expect(d1).not.toBe(d2);
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

            // The check still validates: dropping a dependency makes it throw again.
            (builder as any)._storage = undefined;
            expect(() => (builder as any).ensureNecessary()).toThrow("storage has not been initialized");
        });
    });

    describe("fluent API", () => {
        test.each([
            "useIndexedDB",
            "useWasmOcc",
            "useParametric",
            "useThree",
            "useUI",
        ] as const)("%s should return this and push init function", (method) => {
            const builder = new AppBuilder();
            const before = (builder as any)._inits.length;
            const result = (builder as any)[method]();
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

    describe("assembly inits", () => {
        const lastInit = (builder: AppBuilder): (() => Promise<void>) => {
            const inits = (builder as any)._inits as (() => Promise<void>)[];
            return inits[inits.length - 1];
        };

        test("useWasmOcc init should initialize wasm and set the shape provider", async () => {
            const builder = new AppBuilder();
            builder.useWasmOcc();
            const callsBefore = wasmMock.initWasmCalls;

            await lastInit(builder)();

            expect(wasmMock.initWasmCalls).toBe(callsBefore + 1);
            expect((builder as any)._shapeProvider).toBeInstanceOf(OccShapeProvider);
        });

        test("useThree init should set the visual factory with a property handler", async () => {
            const builder = new AppBuilder();
            builder.useThree();

            await lastInit(builder)();

            const factory = (builder as any)._visualFactory;
            expect(factory).toBeInstanceOf(ThreeVisulFactory);
            expect(typeof factory.handler).toBe("function");
        });

        test("useUI init should set the main window with the default ribbon and #app element", async () => {
            const appDiv = document.createElement("div");
            appDiv.id = "app";
            document.body.appendChild(appDiv);

            const builder = new AppBuilder();
            builder.useUI();
            const argsBefore = uiMock.mainWindowArgs.length;

            await lastInit(builder)();

            expect(uiMock.mainWindowArgs.length).toBe(argsBefore + 1);
            expect(uiMock.mainWindowArgs[argsBefore]).toEqual([DefaultRibbon, "iconfont.js", appDiv]);
            expect((builder as any)._window).toBeInstanceOf(MainWindow);

            appDiv.remove();
        });
    });

    describe("getRibbonTabs", () => {
        test("should return default ribbon tabs", async () => {
            const builder = new AppBuilder();
            const tabs = await builder.getRibbonTabs();
            expect(Array.isArray(tabs)).toBe(true);
            expect(tabs.length).toBeGreaterThan(0);
            expect(tabs[0].tabName).toBe("ribbon.tab.model");
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

    describe("build", () => {
        afterEach(() => {
            rs.unstubAllGlobals();
        });

        test("should execute all registered inits in order and return the application", async () => {
            const builder = new AppBuilder();
            const callOrder: string[] = [];
            const inits = ["first", "second", "third"].map((name) =>
                rs.fn(async () => {
                    callOrder.push(name);
                }),
            );
            (builder as any)._inits = inits;
            (builder as any)._storage = { name: "mockStorage" };
            (builder as any)._shapeProvider = { name: "mockShapeProvider" };
            (builder as any)._visualFactory = { name: "mockVisualFactory" };
            const windowInit = rs.fn((_app: IApplication) => Promise.resolve());
            (builder as any)._window = { init: windowInit } as unknown as IWindow;

            // createApp() is stubbed so build() never touches the global
            // Application singleton (setCurrentApplication allows one call only).
            const fakeApp = { name: "fakeApp" } as unknown as ReturnType<AppBuilder["createApp"]>;
            const createAppSpy = rs.spyOn(builder, "createApp").mockReturnValue(fakeApp);
            rs.stubGlobal(
                "fetch",
                rs.fn(() => Promise.resolve({ ok: false } as Response)),
            );

            const app = await builder.build();

            expect(app).toBe(fakeApp);
            expect(callOrder).toEqual(["first", "second", "third"]);
            for (const init of inits) {
                expect(init).toHaveBeenCalledTimes(1);
            }
            expect(createAppSpy).toHaveBeenCalledTimes(1);
            expect(windowInit).toHaveBeenCalledTimes(1);
            expect(windowInit).toHaveBeenCalledWith(fakeApp);
            createAppSpy.mockRestore();
        });

        test("should skip window init when no window is configured", async () => {
            const builder = new AppBuilder();
            (builder as any)._inits = [];
            (builder as any)._storage = { name: "mockStorage" };
            (builder as any)._shapeProvider = { name: "mockShapeProvider" };
            (builder as any)._visualFactory = { name: "mockVisualFactory" };

            const fakeApp = { name: "fakeApp" } as unknown as ReturnType<AppBuilder["createApp"]>;
            const createAppSpy = rs.spyOn(builder, "createApp").mockReturnValue(fakeApp);
            rs.stubGlobal(
                "fetch",
                rs.fn(() => Promise.resolve({ ok: false } as Response)),
            );

            const app = await builder.build();

            expect(app).toBe(fakeApp);
            expect(createAppSpy).toHaveBeenCalledTimes(1);
            createAppSpy.mockRestore();
        });
    });

    describe("loadDefaultPlugins (protected)", () => {
        afterEach(() => {
            rs.unstubAllGlobals();
        });

        test("should not throw when fetch returns non-ok response", async () => {
            const builder = new AppBuilder();
            rs.stubGlobal(
                "fetch",
                rs.fn(() => Promise.resolve({ ok: false } as Response)),
            );

            const mockApp = { pluginManager: { loadFromUrl: rs.fn() } };
            await expect((builder as any).loadDefaultPlugins(mockApp)).resolves.toBeUndefined();
        });

        test("should handle fetch error gracefully", async () => {
            const builder = new AppBuilder();
            rs.stubGlobal(
                "fetch",
                rs.fn(() => Promise.reject(new Error("network error"))),
            );

            const mockApp = { pluginManager: { loadFromUrl: rs.fn() } };
            // Should not throw — catch block swallows errors
            await expect((builder as any).loadDefaultPlugins(mockApp)).resolves.toBeUndefined();
        });
    });
});
