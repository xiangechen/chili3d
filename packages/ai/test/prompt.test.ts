// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { buildSystemPrompt } from "../src/llm/prompt";
import { SKILLS } from "../src/skills";
import { buildTools } from "../src/tools";

describe("buildSystemPrompt", () => {
    test("indexes every registered tool (the prompt can never drift from the registry)", () => {
        const prompt = buildSystemPrompt();
        for (const tool of buildTools()) {
            expect(prompt).toContain(`- ${tool.name}: `);
        }
    });

    test("keeps the resident prompt compact", () => {
        // Resident prompt budget: guard against accidental bloat (~3.5k tokens at 3.5 chars/token).
        expect(buildSystemPrompt().length).toBeLessThan(12000);
    });

    test("lists every registered skill for on-demand loading", () => {
        const prompt = buildSystemPrompt();
        for (const skill of SKILLS) {
            expect(prompt).toContain(skill.name);
        }
        expect(SKILLS.map((s) => s.name)).toEqual(
            expect.arrayContaining(["shape-query", "modeling-recipes", "error-recovery"]),
        );
    });

    test("ends with a fresh document snapshot section", () => {
        const prompt = buildSystemPrompt();
        expect(prompt).toContain("Current document (snapshot taken when this run started");
        expect(prompt).toContain('"hasActiveDocument":false');
    });
});
