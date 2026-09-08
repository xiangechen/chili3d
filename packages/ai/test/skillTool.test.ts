// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
