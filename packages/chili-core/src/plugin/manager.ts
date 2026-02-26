// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plugin } from "../plugin";

export interface IPluginManager {
    loadFromFile(pluginFile: File): Promise<void>;
    unload(pluginName: string): Promise<void>;
    unloadAll(): void;
    getPlugins(): Plugin[];
    get(pluginName: string): Plugin | undefined;
    isLoaded(pluginName: string): boolean;
}
