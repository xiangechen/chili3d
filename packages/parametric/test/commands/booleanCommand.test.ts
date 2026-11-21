// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, PubSub, Result } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { CutFeatureCommand } from "../../src/commands/booleanCommand";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

describe("BooleanFeatureCommand", () => {
    test("an invalid tool is rejected before a cut feature or transaction is created", () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const host = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: "sketch", depth: 10 }],
        });
        const tool = new EditableShapeNode({
            document: doc,
            name: "invalid tool",
            shape: Result.err("missing source"),
        });
        doc.modelManager.addNode(host);
        doc.modelManager.addNode(tool);
        const command = new CutFeatureCommand();
        (command as any)._application = app;
        (command as any).stepDatas = [{ nodes: [host] }, { nodes: [tool] }];
        const setFeatures = rs.spyOn(host, "setFeaturesEmitShapeChanged").mockImplementation(() => {});
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        const undoCount = doc.history.undoCount();

        try {
            (command as any).executeMainTask();

            expect(pub).toHaveBeenCalledTimes(1);
            expect(pub).toHaveBeenCalledWith("showToast", "error.default:{0}", "Boolean tool has no shape");
            expect(setFeatures).not.toHaveBeenCalled();
            expect(host.features).toHaveLength(1);
            expect(tool.parent).toBe(doc.modelManager.rootNode);
            expect(doc.history.undoCount()).toBe(undoCount);
        } finally {
            pub.mockRestore();
            setFeatures.mockRestore();
        }
    });
});
