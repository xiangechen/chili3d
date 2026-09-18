// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppGuideStore } from "@chili3d/core";
import { SKILLS } from "../src/skills";
import { buildSkillTool } from "../src/skills/skillTool";

describe("skillTool", () => {
    test("returns the skill document for a known name", async () => {
        const tool = buildSkillTool();
        const content = (await tool.handler({ name: "shape-query" })) as string;

        expect(content).toContain("face.area");
        expect(content).toContain("shape.volume");
        expect(content).toContain("curve.length");
        expect(content).toContain("wire.toFace");
    });

    test("the app guide teaches the app, not the modeling API", async () => {
        const tool = buildSkillTool();
        const guide = (await tool.handler({ name: "app-guide" })) as string;

        expect(guide).toContain("## Sketching");
        expect(guide).toContain("## Documents and files");
        expect(guide).toContain("## Parametric features");
        // Where a button sits is deliberately not in the manual — the live ribbon answers that.
        expect(guide).toContain("get_ribbon");
        // The app manual stays distinct from the shape-query reference it sits next to.
        expect(guide).not.toContain("shape.findSubShapes");
    });

    test("appends the sections modules and plugins registered to the app manual", async () => {
        const tool = buildSkillTool();
        try {
            AppGuideStore.registerSection({ name: "demo-plugin", content: "Press the Demo button." });

            const guide = (await tool.handler({ name: "app-guide" })) as string;

            expect(guide).toContain("## demo-plugin\nPress the Demo button.");
            // The built-in manual is still there ahead of the contribution.
            expect(guide).toContain("## Sketching");
        } finally {
            AppGuideStore.unregisterSection("demo-plugin");
        }
    });

    test("drops a contributed section once it is unregistered", async () => {
        const tool = buildSkillTool();
        AppGuideStore.registerSection({ name: "demo-plugin", content: "Press the Demo button." });
        AppGuideStore.unregisterSection("demo-plugin");

        const guide = (await tool.handler({ name: "app-guide" })) as string;

        expect(guide).not.toContain("Press the Demo button.");
    });

    test("serves a base override in place of the built-in manual, still followed by sections", async () => {
        const tool = buildSkillTool();
        try {
            AppGuideStore.setBase("A trimmed manual for this deployment.");
            AppGuideStore.registerSection({ name: "demo-plugin", content: "Press the Demo button." });

            const guide = (await tool.handler({ name: "app-guide" })) as string;

            expect(guide).toBe(
                "A trimmed manual for this deployment.\n\n## demo-plugin\nPress the Demo button.",
            );
        } finally {
            AppGuideStore.clearBase();
            AppGuideStore.unregisterSection("demo-plugin");
        }
    });

    test("falls back to the built-in manual after the override is cleared", async () => {
        const tool = buildSkillTool();
        AppGuideStore.setBase("A trimmed manual for this deployment.");
        AppGuideStore.clearBase();

        const guide = (await tool.handler({ name: "app-guide" })) as string;

        expect(guide).toContain("## Sketching");
        expect(guide).not.toContain("A trimmed manual for this deployment.");
    });

    test("reports an error listing available skills for an unknown name", async () => {
        const tool = buildSkillTool();
        const result = JSON.parse((await tool.handler({ name: "nope" })) as string);

        expect(result.error).toContain("nope");
        expect(result.available).toEqual(SKILLS.map((s) => s.name));
    });

    test("tool description advertises every registered skill", () => {
        const tool = buildSkillTool();
        expect(tool.name).toBe("load_skill");
        for (const skill of SKILLS) {
            expect(tool.description).toContain(skill.name);
        }
    });
});
