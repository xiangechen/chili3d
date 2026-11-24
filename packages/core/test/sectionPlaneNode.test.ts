// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TestDocument } from "@chili3d/core/test-utils";
import { FolderNode, NodeUtils, Plane, SectionPlaneNode, sectionPlaneNodes, XYZ } from "../src";

describe("SectionPlaneNode", () => {
    test("serializes independent planes and restores them as document nodes", async () => {
        const document = new TestDocument();
        const first = new SectionPlaneNode({ document, plane: Plane.XY });
        const second = new SectionPlaneNode({
            document,
            plane: Plane.YZ.translateTo(new XYZ(20, 0, 0)),
        });
        const folder = new FolderNode({ document, name: "Views" });
        document.modelManager.addNode(folder);
        folder.add(first, second);

        const restoredDocument = new TestDocument();
        const restored = await NodeUtils.deserializeNode(restoredDocument, NodeUtils.serializeNode(folder));
        expect(restored).toBeDefined();
        if (!restored) throw new Error("Views folder was not restored");
        restoredDocument.modelManager.addNode(restored);

        const nodes = sectionPlaneNodes(restoredDocument);
        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toBeInstanceOf(SectionPlaneNode);
        expect(nodes[0].plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(nodes[1].plane.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(nodes[1].plane.origin.isEqualTo(new XYZ(20, 0, 0))).toBe(true);
        expect(nodes[0].id).toBe(first.id);
        expect(nodes[1].id).toBe(second.id);
        expect(nodes[0].parent).toBe(nodes[1].parent);
        expect(nodes[0].parent?.name).toBe("Views");
    });
});
