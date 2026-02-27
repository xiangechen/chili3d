// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    I18n,
    type IApplication,
    type IconPath,
    type IPluginManager,
    Logger,
    type Plugin,
    type PluginManifest,
    Result,
    toBase64Img,
} from "chili-api";
import type JSZip from "jszip";

export class PluginManager implements IPluginManager {
    readonly plugins = new Map<string, Plugin>();
    readonly manifests = new Map<string, PluginManifest>();

    constructor(readonly app: IApplication) {}

    async loadFromFile(file: File) {
        const JSZip = await import("jszip");
        const zip = await JSZip.default.loadAsync(file);

        const manifest = await this.readManifest(zip);
        if (!manifest) {
            return;
        }

        if (await this.loadPluginCode(zip, manifest)) {
            Logger.info(`Plugin ${manifest.name} loaded successfully`);
        }
    }

    async loadFromUrl(url: string) {
        const response = await fetch(url);
        if (!response.ok) {
            alert(`Failed to fetch plugin from ${url}: ${response.statusText}`);
            return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: "application/zip" });
        const file = new File([blob], "plugin.chiliplugin");

        await this.loadFromFile(file);
    }

    async loadFromFolder(folderUrl: string, indexName: string = "plugins.json") {
        try {
            const response = await fetch(folderUrl + indexName);
            if (!response.ok) {
                return;
            }
            const config = await response.json();
            const plugins = config.plugins as string[];
            const baseUrl = folderUrl.endsWith("/") ? folderUrl : folderUrl + "/";
            for (const plugin of plugins ?? []) {
                await this.loadFromUrl(baseUrl + plugin);
            }
        } catch {
            Logger.warn(`Failed to load plugins from folder: ${folderUrl}`);
        }
    }

    private async readManifest(zip: JSZip) {
        const manifestFile = zip.file("manifest.json");
        if (!manifestFile) {
            alert("manifest.json not found in plugin archive");
            return undefined;
        }
        const content = await manifestFile.async("text");
        const manifest = JSON.parse(content) as PluginManifest;
        const validation = this.validateManifest(manifest);
        if (!validation.isOk) {
            alert(validation.error);
            return undefined;
        }

        return manifest;
    }

    private async loadPluginCode(zip: JSZip, manifest: PluginManifest) {
        const codeFile = zip.file(manifest.main);
        if (!codeFile) {
            alert(manifest.main + " not found in plugin archive");
            return false;
        }
        const code = await codeFile.async("text");
        const blob = new Blob([code], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        await Promise.try(async () => {
            const module = await import(/*webpackIgnore: true*/ blobUrl);
            await this.transformCommandIcon(zip, module.default);
            this.registerPlugin(module.default);
            this.plugins.set(manifest.name, module.default);
        }).finally(() => {
            URL.revokeObjectURL(blobUrl);
        });
        return true;
    }

    private async transformCommandIcon(zip: JSZip, plugin: Plugin) {
        for (const command of plugin.commands ?? []) {
            const data = CommandStore.getComandData(command);
            const iconData = data?.icon as IconPath;
            if (iconData?.type === "plugin") {
                const codeFile = zip.file(iconData?.path);
                if (!codeFile) {
                    alert(`${iconData.path} not found in plugin archive`);
                    continue;
                }
                const icon = await codeFile.async("base64");
                const base64: string = toBase64Img(iconData.path, icon);
                data!.icon = { type: "url", value: base64 };
            }
        }
    }

    async unload(pluginName: string): Promise<void> {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            return;
        }

        await this.unregisterPlugin(plugin);
        this.plugins.delete(pluginName);

        Logger.info(`Plugin ${pluginName} unloaded successfully`);
    }

    unloadAll(): void {
        for (const [pluginName] of this.plugins) {
            this.unload(pluginName).catch((err) => {
                Logger.error(`Failed to unload plugin ${pluginName}: ${err}`);
            });
        }
    }

    getPlugins(): Plugin[] {
        return Array.from(this.plugins.values());
    }

    get(pluginName: string): Plugin | undefined {
        return this.plugins.get(pluginName);
    }

    isLoaded(pluginName: string): boolean {
        return this.plugins.has(pluginName);
    }

    private validateManifest(manifest: PluginManifest): Result<boolean> {
        if (!manifest.name) Result.err("Missing required field: name");
        if (!manifest.version) Result.err("Missing required field: version");
        if (!manifest.main) Result.err("Missing required field: main");

        if (manifest.version && !this.isValidSemver(manifest.version)) {
            Result.err("Invalid version format (expected semver like 1.0.0)");
        }

        if (manifest.engines?.chili3d) {
            const currentVersion = __APP_VERSION__;
            if (!this.satisfiesVersion(currentVersion, manifest.engines.chili3d)) {
                Result.err(`Chili3D version ${currentVersion} does not satisfy ${manifest.engines.chili3d}`);
            }
        }

        return Result.ok(true);
    }

    private isValidSemver(version: string): boolean {
        // Basic semver validation: major.minor.patch
        const semverRegex = /^\d+\.\d+\.\d+/;
        return semverRegex.test(version);
    }

    private satisfiesVersion(current: string, required: string): boolean {
        // Simple version check: required format like ">=0.6.0"
        const match = required.match(/^>=?(.+)$/);
        if (!match) return true; // Unknown format, allow it

        const requiredVersion = match[1].trim();
        return this.compareVersions(current, requiredVersion) >= 0;
    }

    private compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split(".").map(Number);
        const parts2 = v2.split(".").map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 < p2) return -1;
            if (p1 > p2) return 1;
        }
        return 0;
    }

    private registerPlugin(plugin: Plugin) {
        if (plugin.i18nResources) {
            for (const locale of plugin.i18nResources) {
                const existingLocale = I18n.getLanguages().find((l) => l.language === locale.language);
                if (existingLocale) {
                    I18n.combineTranslation(locale.language, locale.translation);
                } else {
                    I18n.addLanguage(locale);
                }
            }
        }

        if (plugin.services) {
            for (const service of plugin.services) {
                service.register(this.app);
                service.start?.();
            }
        }

        if (plugin.ribbons && this.app?.mainWindow?.ribbon) {
            for (const ribbonContribution of plugin.ribbons) {
                this.app.mainWindow.ribbon.combineRibbonTab(ribbonContribution);
            }
        }
    }

    private async unregisterPlugin(plugin: Plugin): Promise<void> {
        if (plugin.i18nResources) {
            for (const resource of plugin.i18nResources) {
                const keys = Object.keys(resource.translation);
                const keysToRemove = keys.reduce(
                    (acc, key) => {
                        acc[key] = "";
                        return acc;
                    },
                    {} as Record<string, string>,
                );
                I18n.removeTranslation(resource.language, keysToRemove);
            }
        }

        if (plugin.services) {
            for (const service of plugin.services) {
                service.stop?.();
            }
        }

        if (plugin.commands) {
            for (const commandKey of plugin.commands) {
                CommandStore.unregisterCommand(commandKey);
            }
        }
    }
}
