// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GroupNode, type IDocument, Matrix4 } from "../src";
import { TestDocument } from "./testDocument";

describe("test GroupNode", () => {
    const doc: IDocument = new TestDocument() as any;

    test("test constructor", () => {
        const groupNode = new GroupNode(doc, "testGroup");
        expect(groupNode.name).toBe("testGroup");
        expect(groupNode.document).toBe(doc);
    });

    test("test transform getter default", () => {
        const groupNode = new GroupNode(doc, "testGroup");
        const transform = groupNode.transform;
        expect(transform.equals(Matrix4.identity())).toBe(true);
    });

    test("test transform setter", () => {
        const groupNode = new GroupNode(doc, "testGroup");
        const newTransform = Matrix4.fromTranslation(1, 2, 3);
        groupNode.transform = newTransform;
        expect(groupNode.transform.equals(newTransform)).toBe(true);
    });

    test("test transform setter with different matrix", () => {
        const groupNode = new GroupNode(doc, "testGroup");
        const scaleTransform = Matrix4.fromScale(2, 2, 2);
        groupNode.transform = scaleTransform;
        expect(groupNode.transform.equals(scaleTransform)).toBe(true);
        expect(groupNode.transform.equals(Matrix4.identity())).toBe(false);
    });
});
