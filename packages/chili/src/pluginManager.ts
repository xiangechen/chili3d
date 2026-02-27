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

        const manifest = await this.readManifestFromZip(zip);
        if (manifest) {
            await this.loadPluginCodeFromZip(zip, manifest);
        }
    }

    async loadFromUrl(url: string) {
        if (url.endsWith(".chiliplugin")) {
            const response = await fetch(url);
            if (!response.ok) {
                alert(`Failed to fetch plugin from ${url}: ${response.statusText}`);
                return;
            }

            const arrayBuffer = await response.arrayBuffer();
            const blob = new Blob([arrayBuffer], { type: "application/zip" });
            const file = new File([blob], "plugin.chiliplugin");

            await this.loadFromFile(file);
        } else {
            if (!url.endsWith("/")) url += "/";
            const manifest = await this.readManifestFromUrl(url + "manifest.json");
            if (manifest) {
                await this.loadPluginCodeFromUrl(manifest.name, url, manifest.main);
            }
        }
    }

    private async readManifestFromZip(zip: JSZip) {
        const manifestFile = zip.file("manifest.json");
        if (!manifestFile) {
            alert("manifest.json not found in plugin archive");
            return undefined;
        }

        const content = await manifestFile.async("text");
        const manifest = JSON.parse(content) as PluginManifest;
        return this.validateManifest(manifest) ? manifest : undefined;
    }

    private async readManifestFromUrl(url: string) {
        const response = await fetch(url);
        if (!response.ok) {
            return undefined;
        }
        const manifest: PluginManifest = await response.json();
        return this.validateManifest(manifest) ? manifest : undefined;
    }

    private async loadPluginCodeFromZip(zip: JSZip, manifest: PluginManifest) {
        const codeFile = zip.file(manifest.main);
        if (!codeFile) {
            alert(manifest.main + " not found in plugin archive");
            return;
        }
        const code = await codeFile.async("text");
        const handlePluginIcon = async (plugin: Plugin) => {
            await this.transformZipCommandIcon(zip, plugin);
        };
        await this.loadPluginCode(manifest.name, code, handlePluginIcon);
    }

    private async loadPluginCodeFromUrl(name: string, baseUrl: string, codePath: string) {
        if (codePath.startsWith("/")) codePath = codePath.substring(1);

        const fullUrl = baseUrl + codePath;
        const response = await fetch(fullUrl);
        if (!response.ok) {
            return undefined;
        }

        const code = await response.text();
        const handlePluginIcon = async (plugin: Plugin) => {
            await this.transformUrlCommandIcon(baseUrl, plugin);
        };
        await this.loadPluginCode(name, code, handlePluginIcon);
    }

    private async loadPluginCode(
        name: string,
        code: string,
        handlePluginIcon: (plugin: Plugin) => Promise<void>,
    ) {
        const blob = new Blob([code], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        await Promise.try(async () => {
            const module = await import(/*webpackIgnore: true*/ blobUrl);
            const plugin: Plugin = module.default;
            await handlePluginIcon(plugin);
            this.registerPlugin(plugin);
            this.plugins.set(name, plugin);

            Logger.info(`Plugin ${name} loaded successfully`);
        })
            .catch((err) => {
                alert(`Failed to load plugin ${name}: ${err}`);
            })
            .finally(() => {
                URL.revokeObjectURL(blobUrl);
            });
    }

    private async transformZipCommandIcon(zip: JSZip, plugin: Plugin) {
        for (const command of plugin.commands ?? []) {
            const data = CommandStore.getComandData(command);
            const iconData = data?.icon as IconPath;
            if (iconData?.type === "path") {
                const codeFile = zip.file(iconData?.value);
                if (!codeFile) {
                    alert(`${iconData.value} not found in plugin archive`);
                    continue;
                }
                const icon = await codeFile.async("base64");
                const base64: string = toBase64Img(iconData.value, icon);
                data!.icon = { type: "url", value: base64 };
            }
        }
    }

    private async transformUrlCommandIcon(baseUrl: string, plugin: Plugin) {
        for (const command of plugin.commands ?? []) {
            const data = CommandStore.getComandData(command);
            const iconData = data?.icon as IconPath;
            if (iconData?.type === "path") {
                data!.icon = { type: "url", value: baseUrl + iconData.value };
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

    private validateManifest(manifest: PluginManifest) {
        if (this.manifests.has(manifest.name)) {
            alert(`Plugin ${manifest.name} already loaded`);
            return false;
        }

        const errors: string[] = [];
        if (!manifest.name) errors.push("Missing required field: name");
        if (!manifest.version) errors.push("Missing required field: version");
        if (!manifest.main) errors.push("Missing required field: main");
        if (manifest.version && !this.isValidSemver(manifest.version)) {
            errors.push("Invalid version format (expected semver like 1.0.0)");
        }
        if (manifest.engines?.chili3d) {
            const currentVersion = __APP_VERSION__;
            if (!this.satisfiesVersion(currentVersion, manifest.engines.chili3d)) {
                errors.push(`Chili3D version ${currentVersion} does not satisfy ${manifest.engines.chili3d}`);
            }
        }

        if (errors.length > 0) {
            alert(
                "Load plugin " +
                    manifest.name +
                    " failed:\n" +
                    errors.map((x, i) => `${i + 1}. ${x}`).join("\n"),
            );
            return false;
        }

        this.manifests.set(manifest.name, manifest);
        return true;
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
