// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandStore, Config, type IApplication, type Plugin, type PluginManifest } from "@chili3d/core";
import { rs } from "@rstest/core";
import { PluginManager } from "../src/pluginManager";

// `describe`, `test`, `expect`, `beforeEach`, `afterEach` are provided as
// globals by Rstest (see rstest.config.ts: globals: true).

/**
 * Hoisted mutable container so a single top-level `rs.mock("jszip", ...)` can
 * serve per-test fixtures. Each `loadFromFile` test writes its fake file map
 * into `fakeFiles.current` before invoking the manager.
 */
const fakeFiles = rs.hoisted<{ current: Record<string, string> | null }>(() => ({
    current: null,
}));

rs.mock("jszip", () => ({
    default: {
        loadAsync: async () => ({
            file(name: string) {
                const files = fakeFiles.current ?? {};
                return name in files ? { async: async () => files[name] } : null;
            },
        }),
    },
}));

function validManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        name: "demo-plugin",
        version: "1.0.0",
        main: "index.js",
        ...overrides,
    };
}

function createManager(): { manager: PluginManager; app: IApplication } {
    const app = {
        mainWindow: {
            ribbon: { combineRibbonTab: rs.fn() },
        },
    } as unknown as IApplication;
    const manager = new PluginManager(app);
    return { manager, app };
}

describe("PluginManager", () => {
    let originalAlert: typeof alert;
    let originalFetch: typeof fetch;
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;
    let originalLocation: Location;

    beforeEach(() => {
        originalAlert = globalThis.alert;
        originalFetch = globalThis.fetch;
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        originalLocation = window.location;
        Config.instance.trustedDomains = [];
        // happy-dom/Node Blob mismatch makes the native URL.createObjectURL
        // throw; provide a no-op stub so zip-loading tests can reach loadMainCode.
        URL.createObjectURL = (() => "blob:stub") as typeof URL.createObjectURL;
        URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    });

    afterEach(() => {
        globalThis.alert = originalAlert;
        globalThis.fetch = originalFetch;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        Object.defineProperty(window, "location", {
            value: originalLocation,
            configurable: true,
        });
    });

    describe("getPlugins / get / isLoaded", () => {
        test("should expose empty state initially", () => {
            const { manager } = createManager();
            expect(manager.getPlugins()).toEqual([]);
            expect(manager.get("anything")).toBeUndefined();
            expect(manager.isLoaded("anything")).toBe(false);
        });

        test("should report loaded plugin after direct registration", () => {
            const { manager } = createManager();
            const plugin: Plugin = {};
            (manager as any).plugins.set("p", plugin);

            expect(manager.getPlugins()).toEqual([plugin]);
            expect(manager.get("p")).toBe(plugin);
            expect(manager.isLoaded("p")).toBe(true);
        });
    });

    describe("unload", () => {
        test("should be a no-op when the plugin is not loaded", async () => {
            const { manager } = createManager();
            await expect(manager.unload("missing")).resolves.toBeUndefined();
        });

        test("should remove plugin and revoke importmap blob urls", async () => {
            const { manager } = createManager();
            const unregisterSpy = rs.spyOn(CommandStore, "unregisterCommand").mockImplementation(() => {});
            const revokeSpy = rs.fn();
            URL.revokeObjectURL = revokeSpy;

            const plugin: Plugin = {};
            (manager as any).plugins.set("p", plugin);
            (manager as any).shouldRevokes.set("p", ["blob:1", "blob:2"]);

            await manager.unload("p");

            expect(manager.isLoaded("p")).toBe(false);
            expect(revokeSpy).toHaveBeenCalledTimes(2);
            unregisterSpy.mockRestore();
        });
    });

    describe("loadFromFile (zip path)", () => {
        test("should alert when manifest.json is missing", async () => {
            fakeFiles.current = { "index.js": "console.log(1)" };
            const alertSpy = rs.fn();
            globalThis.alert = alertSpy;
            const { manager } = createManager();

            await manager.loadFromFile(new File([], "plugin.zip"));

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("manifest.json not found"));
            expect(manager.getPlugins()).toEqual([]);
        });

        test("should skip loading when manifest validation fails (missing version + main)", async () => {
            fakeFiles.current = {
                "manifest.json": JSON.stringify({ name: "x" }),
                "index.js": "",
            };
            const alertSpy = rs.fn();
            globalThis.alert = alertSpy;
            const { manager } = createManager();

            await manager.loadFromFile(new File([], "plugin.zip"));

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Missing required field: version"));
            expect(manager.getPlugins()).toEqual([]);
        });

        test("should alert when the code entry referenced by manifest.main is missing", async () => {
            fakeFiles.current = {
                "manifest.json": JSON.stringify(validManifest({ main: "missing.js" })),
            };
            const alertSpy = rs.fn();
            globalThis.alert = alertSpy;
            const { manager } = createManager();

            await manager.loadFromFile(new File([], "plugin.zip"));

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("missing.js not found"));
        });

        test("should alert when a duplicate plugin name is loaded", async () => {
            fakeFiles.current = {
                "manifest.json": JSON.stringify(validManifest()),
                "index.js": "",
            };
            const alertSpy = rs.fn();
            globalThis.alert = alertSpy;
            const { manager } = createManager();
            // seed manifests map as if already loaded
            (manager as any).manifests.set("demo-plugin", validManifest());

            await manager.loadFromFile(new File([], "plugin.zip"));

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("already loaded"));
        });

        test("should load a valid archive by calling loadMainCode with a blob url", async () => {
            fakeFiles.current = {
                "manifest.json": JSON.stringify(validManifest()),
                "index.js": "// plugin entry",
            };
            const createSpy = rs.fn(() => "blob:code-url");
            URL.createObjectURL = createSpy;

            const { manager } = createManager();
            const loadMainSpy = rs.spyOn(manager as any, "loadMainCode").mockResolvedValue(undefined);

            await manager.loadFromFile(new File([], "plugin.zip"));
            await Promise.resolve();

            expect(createSpy).toHaveBeenCalled();
            expect(loadMainSpy).toHaveBeenCalledWith("demo-plugin", "blob:code-url", expect.any(Function));
            loadMainSpy.mockRestore();
        });
    });

    describe("loadFromUrl", () => {
        test("should not call fetch for an unknown host (dialog branch)", async () => {
            const { manager } = createManager();
            const fetchSpy = rs.fn();
            globalThis.fetch = fetchSpy;
            Object.defineProperty(window, "location", {
                value: { host: "localhost", href: "https://localhost/" },
                configurable: true,
            });

            await manager.loadFromUrl("https://example.com/plugin");

            expect(fetchSpy).not.toHaveBeenCalled();
        });

        test("should fetch manifest for a same-host folder url", async () => {
            const { manager } = createManager();
            Object.defineProperty(window, "location", {
                value: { host: "localhost", href: "https://localhost/" },
                configurable: true,
            });
            const manifest = validManifest();
            globalThis.fetch = rs.fn().mockResolvedValue({
                ok: true,
                json: async () => manifest,
                text: async () => "// code",
            }) as any;

            const loadPluginSpy = rs.spyOn(manager as any, "loadPluginFromUrl").mockResolvedValue(undefined);

            await manager.loadFromUrl("https://localhost/plugin/");

            expect(loadPluginSpy).toHaveBeenCalledWith(
                "demo-plugin",
                "https://localhost/plugin/",
                "index.js",
                undefined,
            );
            loadPluginSpy.mockRestore();
        });

        test("should not load when remote manifest fetch fails", async () => {
            const { manager } = createManager();
            Object.defineProperty(window, "location", {
                value: { host: "localhost", href: "https://localhost/" },
                configurable: true,
            });
            globalThis.fetch = rs.fn().mockResolvedValue({ ok: false, statusText: "Not Found" }) as any;

            const loadPluginSpy = rs.spyOn(manager as any, "loadPluginFromUrl").mockResolvedValue(undefined);

            await manager.loadFromUrl("https://localhost/plugin/");

            expect(loadPluginSpy).not.toHaveBeenCalled();
            loadPluginSpy.mockRestore();
        });

        test("should skip hosts in trustedDomains without confirmation", async () => {
            const { manager } = createManager();
            Object.defineProperty(window, "location", {
                value: { host: "localhost", href: "https://localhost/" },
                configurable: true,
            });
            Config.instance.trustedDomains = ["cdn.example.com"];
            const manifest = validManifest();
            globalThis.fetch = rs.fn().mockResolvedValue({
                ok: true,
                json: async () => manifest,
            }) as any;

            const loadRemoteSpy = rs.spyOn(manager as any, "loadFromRemoteFile").mockResolvedValue(undefined);

            await manager.loadFromUrl("https://cdn.example.com/p");

            expect(loadRemoteSpy).toHaveBeenCalledWith("https://cdn.example.com/p");
            loadRemoteSpy.mockRestore();
        });
    });

    describe("unloadAll", () => {
        test("should iterate all loaded plugins and unload each", async () => {
            const { manager } = createManager();
            const unloadSpy = rs.spyOn(manager, "unload").mockResolvedValue(undefined);
            (manager as any).plugins.set("a", {});
            (manager as any).plugins.set("b", {});

            manager.unloadAll();
            await Promise.resolve();
            await Promise.resolve();

            expect(unloadSpy).toHaveBeenCalledWith("a");
            expect(unloadSpy).toHaveBeenCalledWith("b");
            unloadSpy.mockRestore();
        });
    });

    describe("manifest validation (private)", () => {
        function validate(manager: PluginManager, manifest: Partial<PluginManifest>): boolean {
            return (manager as any).validateManifest(manifest);
        }

        test("should reject a duplicate name", () => {
            const { manager } = createManager();
            (manager as any).manifests.set("dup", validManifest());
            globalThis.alert = rs.fn();

            expect(validate(manager, { name: "dup", version: "1.0.0", main: "x.js" })).toBe(false);
        });

        test("should reject an invalid semver version", () => {
            const { manager } = createManager();
            globalThis.alert = rs.fn();

            expect(validate(manager, { name: "p", version: "not-a-version", main: "x.js" })).toBe(false);
        });

        test("should reject when engine requirement is not satisfied", () => {
            const { manager } = createManager();
            globalThis.alert = rs.fn();

            const ok = validate(manager, {
                name: "p",
                version: "1.0.0",
                main: "x.js",
                engines: { chili3d: ">=99.0.0" },
            });
            expect(ok).toBe(false);
        });

        test("should accept a complete valid manifest", () => {
            const { manager } = createManager();
            globalThis.alert = rs.fn();

            expect(validate(manager, validManifest())).toBe(true);
            expect((manager as any).manifests.has("demo-plugin")).toBe(true);
        });

        test("compareVersions should order versions correctly", () => {
            const { manager } = createManager();
            const cmp = (a: string, b: string) => (manager as any).compareVersions(a, b);
            expect(cmp("1.0.0", "1.0.0")).toBe(0);
            expect(cmp("1.2.0", "1.0.0")).toBe(1);
            expect(cmp("0.9.9", "1.0.0")).toBe(-1);
            expect(cmp("2.0.0", "1.99.99")).toBe(1);
        });

        test("satisfiesVersion should strip -beta suffix from current version", () => {
            const { manager } = createManager();
            const sat = (current: string, required: string) =>
                (manager as any).satisfiesVersion(current, required);
            expect(sat("0.7.0-beta", ">=0.6.0")).toBe(true);
            expect(sat("0.5.0", ">=0.6.0")).toBe(false);
            // unknown format -> allow
            expect(sat("1.0.0", "^1.0.0")).toBe(true);
        });

        test("isValidSemver should match major.minor.patch prefix", () => {
            const { manager } = createManager();
            const ok = (v: string) => (manager as any).isValidSemver(v);
            expect(ok("1.0.0")).toBe(true);
            expect(ok("1.2.3-beta.0")).toBe(true);
            expect(ok("1.0")).toBe(false);
            expect(ok("latest")).toBe(false);
        });
    });
});
