// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plugin } from "./plugin";

export interface IPluginManager {
    /**
     * Load plugins from a file, the plugin file must be a zip file
     * @param pluginFile the plugin file, must be a zip file.
     * It must have a manifest.json file inside,
     * manifest.json must be a valid plugin manifest see PluginManifest for more details
     */
    loadFromFile(pluginFile: File): Promise<void>;
    /**
     * Load plugins from a url,
     * if the url is a zip file, it will be loaded as a plugin, eg: https://example.com/plugin1.chiliplugin
     * if the url is a directory, it will be loaded as a plugin folder, eg: https://example.com/plugin1, the plugin folder must have a manifest.json file inside,
     * @param pluginUrl the plugin url
     */
    loadFromUrl(pluginUrl: string): Promise<void>;
    unload(pluginName: string): Promise<void>;
    unloadAll(): void;
    getPlugins(): Plugin[];
    get(pluginName: string): Plugin | undefined;
    isLoaded(pluginName: string): boolean;
}
