// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface AppGuideSection {
    /** Heading of the section; registering the same name again replaces the earlier section. */
    name: string;
    content: string;
}

const sections = new Map<string, AppGuideSection>();
let base: string | undefined;

/**
 * The app manual's extension point. The AI assistant's `app-guide` skill ships a built-in
 * manual of the standard UI, appends every section registered here, and lets a base override
 * replace the built-in text altogether — so a module that adds commands of its own, or a build
 * that needs a different manual (another language, a white label), can do either without the
 * ai package knowing it exists: the ai package is an optional consumer, while this store lives
 * where every module can reach it.
 *
 * Register from a module's import (a plugin declares its sections in `Plugin.guide` instead,
 * and the plugin manager registers them when the plugin loads), and keep names unique across
 * packages — a plugin is unloaded by name, so an unnamespaced name could remove another's.
 */
export class AppGuideStore {
    /** Replaces the built-in manual. The last caller wins; sections still follow it. */
    static setBase(content: string): void {
        base = content;
    }

    static getBase(): string | undefined {
        return base;
    }

    /** Drops the override, restoring the built-in manual. */
    static clearBase(): void {
        base = undefined;
    }

    static registerSection(section: AppGuideSection): void {
        sections.set(section.name, section);
    }

    static unregisterSection(name: string): void {
        sections.delete(name);
    }

    static getSections(): AppGuideSection[] {
        return [...sections.values()];
    }
}
