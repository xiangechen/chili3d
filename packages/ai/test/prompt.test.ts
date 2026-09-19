// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { buildSystemPrompt } from "../src/llm/prompt";
import { SKILLS } from "../src/skills";
import { buildTools } from "../src/tools";

describe("buildSystemPrompt", () => {
    test("indexes every registered tool (the prompt can never drift from the registry)", () => {
        const { stable } = buildSystemPrompt();
        for (const tool of buildTools()) {
            expect(stable).toContain(`- ${tool.name}: `);
        }
    });

    test("index entries are whole sentences, never cut at an abbreviation", () => {
        const { stable } = buildSystemPrompt();
        const selectLine = stable.split("\n").find((line) => line.startsWith("- select_nodes: "));

        // Splitting on the first ". " used to stop at this description's "— e.g." and leave the
        // index showing a fragment; the sentence has to run to its end.
        expect(selectLine).toContain("then call fit_content to focus them.");
        expect(stable).not.toMatch(/^\s*- .*\be\.g\.$/m);
    });

    test("keeps the resident prompt compact", () => {
        // The creation-method catalog moved into the modeling-api skill, which took the
        // resident half from ~11.9k to ~7k. This bound guards against creeping back.
        const { stable, volatile } = buildSystemPrompt();
        expect(stable.length + volatile.length).toBeLessThan(8000);
    });

    test("keeps the creation-method catalog out of the resident half", () => {
        const { stable, volatile } = buildSystemPrompt();
        // It lives in the modeling-api skill now; inlining it again would take the
        // resident prompt back to the top of its budget.
        expect(stable).not.toContain("Available modeling capabilities");
        expect(volatile).not.toContain("Available modeling capabilities");
    });

    test("lists every registered skill for on-demand loading", () => {
        const { stable } = buildSystemPrompt();
        for (const skill of SKILLS) {
            expect(stable).toContain(skill.name);
        }
        expect(SKILLS.map((s) => s.name)).toEqual(
            expect.arrayContaining(["shape-query", "modeling-recipes", "error-recovery"]),
        );
    });

    test("holds the per-run document snapshot in the volatile half only", () => {
        const { stable, volatile } = buildSystemPrompt();
        expect(volatile).toContain("Current document (snapshot taken when this run started");
        expect(volatile).toContain('"hasActiveDocument":false');
        // The cache breakpoint sits at the end of the stable half: a per-run section inside it
        // would invalidate the tool schemas and the rest of the prompt on every run.
        expect(stable).not.toContain("Current document (snapshot");
        expect(stable).not.toContain('"hasActiveDocument"');
    });

    test("builds the same stable half twice in a row", () => {
        // Determinism is what lets the provider reuse the cached prefix; a timestamp or an id
        // interpolated into a section would fail here.
        expect(buildSystemPrompt().stable).toBe(buildSystemPrompt().stable);
    });
});
