// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SKILLS } from "./registry";
import type { Skill } from "./types";

const registered = new Map<string, Skill>();

/**
 * The skill registry's extension point, the counterpart of `AppGuideStore`: a module or a
 * build that contributes a skill of its own registers it here instead of editing the
 * built-in list, so the ai package stays unaware of it and an upstream sync cannot drop the
 * contribution.
 *
 * Register from a module's import, before the assistant builds its tools. A name that is
 * already built in is replaced in place — the merged order keeps that skill where it was, so
 * an override cannot reshuffle the prompt prefix conversations are cached against.
 */
export class SkillStore {
    static register(skill: Skill): void {
        registered.set(skill.name, skill);
    }

    /**
     * Removes a contribution. A name that is also built in only loses its override — the
     * built-in skill comes back — so this can never leave the registry missing a skill.
     */
    static unregister(name: string): void {
        registered.delete(name);
    }

    /** Built-in skills in their advertised order, with registered contributions merged in. */
    static getAll(): Skill[] {
        const merged = new Map<string, Skill>();
        for (const skill of SKILLS) merged.set(skill.name, skill);
        for (const [name, skill] of registered) merged.set(name, skill);
        return [...merged.values()];
    }
}
