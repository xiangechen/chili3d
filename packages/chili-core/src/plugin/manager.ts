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
     * Load plugins from a url, the plugin file must be a zip file
     * @param pluginUrl the plugin url
     */
    loadFromUrl(pluginUrl: string): Promise<void>;
    /**
     * Load plugins from a folder, the index file is optional, if not specified, the default plugins.json will be used
     * @param folderUrl the folder url
     * @param indexName the index file name, default is plugins.json
     */
    loadFromFolder(folderUrl: string, indexName?: string): Promise<void>;
    unload(pluginName: string): Promise<void>;
    unloadAll(): void;
    getPlugins(): Plugin[];
    get(pluginName: string): Plugin | undefined;
    isLoaded(pluginName: string): boolean;
}
