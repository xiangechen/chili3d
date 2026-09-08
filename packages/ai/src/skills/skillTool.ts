// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Tool } from "../llm/types";
import { SKILLS } from "./registry";

/**
 * Progressive disclosure: the system prompt lists skills by name and one-line
 * description; the model pulls the full document only when it needs it.
 */
export function buildSkillTool(): Tool {
    return {
        name: "load_skill",
        description: `Load a reference document on demand. Available skills: ${SKILLS.map(
            (s) => `${s.name} — ${s.description}`,
        ).join("; ")}`,
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", enum: SKILLS.map((s) => s.name) },
            },
            required: ["name"],
        },
        handler: (args) => {
            const name = (args as { name?: unknown }).name;
            const skill = SKILLS.find((s) => s.name === name);
            if (!skill) {
                return Promise.resolve(
                    JSON.stringify({
                        error: `unknown skill "${name}"`,
                        available: SKILLS.map((s) => s.name),
                    }),
                );
            }
            return Promise.resolve(skill.content);
        },
    };
}
