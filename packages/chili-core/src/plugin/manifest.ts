// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Author information type
 */
export type PluginAuthor =
    | string
    | {
          name: string;
          email?: string;
          url?: string;
      };

/**
 * Engine requirements type
 */
export type PluginEngines = {
    /** Chili3D version requirement (semver range, e.g., ">=0.6.0") */
    chili3d?: string;
};

/**
 * Plugin manifest type
 */
export type PluginManifest = {
    /** Plugin name */
    name: string;

    /** Version number (semver format) */
    version: string;

    /** Main entry file (relative path) */
    main: string;

    /** Author information */
    author?: PluginAuthor;

    /** Plugin description */
    description?: string;

    /** Plugin icon path (relative path) */
    icon?: string;

    /** Engine compatibility requirements */
    engines?: PluginEngines;

    /** Dependencies on other plugins (plugin ID -> version range) */
    dependencies?: Record<string, string>;
};
