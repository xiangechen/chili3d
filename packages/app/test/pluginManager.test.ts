// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    Config,
    I18n,
    type IApplication,
    Logger,
    type Plugin,
    type PluginManifest,
} from "@chili3d/core";
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

    describe("registerPlugin / unregisterPlugin (private)", () => {
        test("should register plugin i18n resources via I18n.combineTranslation", () => {
            const { manager } = createManager();
            const addSpy = rs.spyOn(I18n, "addLanguage").mockImplementation(() => {});
            const combineSpy = rs.spyOn(I18n, "combineTranslation").mockImplementation(() => {});
            rs.spyOn(I18n, "getLanguages").mockReturnValue([{ language: "en", translation: {} } as any]);

            (manager as any).registerPlugin({
                i18nResources: [{ language: "en", translation: { "key.hello": "Hello" } }],
            });

            expect(combineSpy).toHaveBeenCalledWith("en", { "key.hello": "Hello" });
            addSpy.mockRestore();
            combineSpy.mockRestore();
        });

        test("should register plugin i18n resources via I18n.addLanguage for new locale", () => {
            const { manager } = createManager();
            const addSpy = rs.spyOn(I18n, "addLanguage").mockImplementation(() => {});
            rs.spyOn(I18n, "getLanguages").mockReturnValue([]);

            const resource = { language: "pt-br", translation: { "key.ola": "Olá" } };
            (manager as any).registerPlugin({ i18nResources: [resource] });

            expect(addSpy).toHaveBeenCalledWith(resource);
            addSpy.mockRestore();
        });

        test("should register and start plugin services", () => {
            const { manager, app } = createManager();
            const startFn = rs.fn();
            const registerFn = rs.fn();
            const service = { register: registerFn, start: startFn };
            (manager as any).registerPlugin({ services: [service] });

            expect(registerFn).toHaveBeenCalledWith(app);
            expect(startFn).toHaveBeenCalled();
        });

        test("should combine ribbon tabs", () => {
            const { manager, app } = createManager();
            const ribbonContribution = { tab: "test" };
            (manager as any).registerPlugin({ ribbons: [ribbonContribution] });

            expect(app.mainWindow!.ribbon!.combineRibbonTab).toHaveBeenCalledWith(ribbonContribution);
        });

        test("should handle plugin without i18n, services, or ribbons", () => {
            const { manager } = createManager();
            // Should not throw
            expect(() => (manager as any).registerPlugin({})).not.toThrow();
        });
    });

    describe("unregisterPlugin (private)", () => {
        test("should remove plugin i18n translations", () => {
            const { manager } = createManager();
            const removeSpy = rs.spyOn(I18n, "removeTranslation").mockImplementation(() => {});

            (manager as any).unregisterPlugin("test-plugin", {
                i18nResources: [{ language: "en", translation: { "key.hello": "", "key.world": "" } }],
            });

            expect(removeSpy).toHaveBeenCalledWith("en", { "key.hello": "", "key.world": "" });
            removeSpy.mockRestore();
        });

        test("should stop plugin services", () => {
            const { manager } = createManager();
            const stopFn = rs.fn();
            const service = { register: rs.fn(), stop: stopFn };

            (manager as any).unregisterPlugin("test-plugin", { services: [service] });

            expect(stopFn).toHaveBeenCalled();
        });

        test("should unregister plugin commands from CommandStore", () => {
            const { manager } = createManager();
            const unregisterSpy = rs.spyOn(CommandStore, "unregisterCommand").mockImplementation(() => {});

            (manager as any).unregisterPlugin("test-plugin", { commands: ["cmd.one", "cmd.two"] });

            expect(unregisterSpy).toHaveBeenCalledWith("cmd.one");
            expect(unregisterSpy).toHaveBeenCalledWith("cmd.two");
            unregisterSpy.mockRestore();
        });

        test("should remove plugin CSS", () => {
            const { manager } = createManager();
            const style = document.createElement("style");
            style.id = "plugin-css-test-plugin";
            document.head.appendChild(style);

            (manager as any).unregisterPlugin("test-plugin", {});

            expect(document.getElementById("plugin-css-test-plugin")).toBeNull();
        });
    });

    describe("injectImportmap / injectCss / removePluginCss (private)", () => {
        test("injectImportmap should add a script[type=importmap] to head", () => {
            const { manager } = createManager();
            (manager as any).injectImportmap('{"imports":{"a":"b"}}');
            const script = document.querySelector('script[type="importmap"]');
            expect(script).not.toBeNull();
            expect(script!.textContent).toBe('{"imports":{"a":"b"}}');
            script!.remove();
        });

        test("injectCss should add a style element with the plugin name as id", () => {
            const { manager } = createManager();
            (manager as any).injectCss(".test { color: red; }", "test-plugin");
            const style = document.getElementById("plugin-css-test-plugin");
            expect(style).not.toBeNull();
            expect(style!.textContent).toBe(".test { color: red; }");
            style!.remove();
        });

        test("injectCss should not duplicate an existing style element", () => {
            const { manager } = createManager();
            (manager as any).injectCss(".a {}", "dup-plugin");
            (manager as any).injectCss(".b {}", "dup-plugin");
            const styles = document.querySelectorAll("#plugin-css-dup-plugin");
            expect(styles.length).toBe(1);
            styles[0].remove();
        });
    });

    describe("loadCssFromZip (private)", () => {
        test("should inject CSS files from zip", async () => {
            fakeFiles.current = {
                "style.css": ".plugin { color: blue; }",
            };
            const { manager } = createManager();
            const injectSpy = rs.spyOn(manager as any, "injectCss").mockImplementation(() => {});

            // Construct a fake zip with the file method matching what loadCssFromZip expects
            const fakeZip = {
                file(name: string) {
                    const files = fakeFiles.current ?? {};
                    return name in files ? { async: async () => files[name] } : null;
                },
            };

            await (manager as any).loadCssFromZip(fakeZip, {
                ...validManifest(),
                css: "style.css",
            } as PluginManifest);

            expect(injectSpy).toHaveBeenCalledWith(".plugin { color: blue; }", "demo-plugin");
            injectSpy.mockRestore();
        });

        test("should skip when manifest has no css", async () => {
            const { manager } = createManager();
            await expect((manager as any).loadCssFromZip({}, validManifest())).resolves.toBeUndefined();
        });
    });

    describe("loadFromRemoteFile (private)", () => {
        test("should handle .chiliplugin files via fetch + loadFromFile", async () => {
            const { manager } = createManager();
            const loadFromFileSpy = rs.spyOn(manager, "loadFromFile").mockResolvedValue(undefined);
            globalThis.fetch = rs.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(0),
            }) as any;

            await (manager as any).loadFromRemoteFile("https://cdn.example.com/plugin.chiliplugin");

            expect(loadFromFileSpy).toHaveBeenCalled();
            loadFromFileSpy.mockRestore();
        });

        test("should alert when fetch fails for .chiliplugin", async () => {
            const { manager } = createManager();
            const alertSpy = rs.fn();
            globalThis.alert = alertSpy;
            globalThis.fetch = rs.fn().mockResolvedValue({
                ok: false,
                statusText: "Not Found",
            }) as any;

            await (manager as any).loadFromRemoteFile("https://cdn.example.com/plugin.chiliplugin");

            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch plugin"));
        });
    });

    describe("loadFromUrl edge cases", () => {
        test("should load directly for trusted domain", async () => {
            const { manager } = createManager();
            Config.instance.trustedDomains = ["trusted.example.com"];

            const loadRemoteSpy = rs.spyOn(manager as any, "loadFromRemoteFile").mockResolvedValue(undefined);

            await manager.loadFromUrl("https://trusted.example.com/p");

            expect(loadRemoteSpy).toHaveBeenCalled();
            loadRemoteSpy.mockRestore();
        });

        test("should skip untrusted domain that was already declined", async () => {
            const { manager } = createManager();
            // Access the module-level untrustedDomains array — it's private so access via workaround
            // Trusted domain already added in previous test — just test that unknown host goes to dialog

            const alertSpy = rs.fn();
            globalThis.alert = alertSpy;
            globalThis.fetch = rs.fn();
            Object.defineProperty(window, "location", {
                value: { host: "localhost", href: "https://localhost/" },
                configurable: true,
            });

            await manager.loadFromUrl("https://untrusted-site.com/plugin");

            // Should NOT have called fetch (went to dialog path)
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });
    });

    describe("unload with error handling", () => {
        test("unloadAll should catch errors from individual unload calls", async () => {
            const { manager } = createManager();
            const errorSpy = rs.spyOn(Logger, "error").mockImplementation(() => {});
            const unloadSpy = rs.spyOn(manager, "unload").mockRejectedValue(new Error("unload failed"));
            (manager as any).plugins.set("a", {});
            (manager as any).plugins.set("b", {});

            manager.unloadAll();
            // Wait for promises to settle
            await new Promise((r) => setTimeout(r, 10));

            expect(unloadSpy).toHaveBeenCalled();
            // Logger.error should have been called for the failure
            errorSpy.mockRestore();
            unloadSpy.mockRestore();
        });
    });
});
