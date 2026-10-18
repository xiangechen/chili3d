// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BodyInstanceNode,
    cloneForCopyNode,
    EditableShapeNode,
    instanceSourcesInUse,
    isInstanceNode,
    Matrix4,
    Mesh,
    MeshInstanceNode,
    MeshNode,
    retargetInstanceSources,
    Serializer,
} from "../src";
import { createMockShape, TestDocument } from "../test-utils";

function surface(): Mesh {
    return new Mesh({
        meshType: "surface",
        position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uv: new Float32Array([0, 0, 1, 0, 0, 1]),
        index: new Uint32Array([0, 1, 2]),
    });
}

function scene() {
    const doc = new TestDocument();
    const source = new MeshNode({
        document: doc,
        name: "mesh",
        mesh: surface(),
        materialId: "mat-a",
    });
    doc.modelManager.addNode(source);
    return { doc, source };
}

describe("MeshInstanceNode", () => {
    test("a MeshNode copies as a mesh instance at the source's placement", () => {
        const { doc, source } = scene();
        source.transform = Matrix4.fromTranslation(1, 0, 0);

        const copy = cloneForCopyNode(source, Matrix4.fromTranslation(10, 0, 0));

        expect(copy).toBeInstanceOf(MeshInstanceNode);
        expect(isInstanceNode(copy)).toBe(true);
        const instance = copy as MeshInstanceNode;
        expect(instance.source).toBe(source);
        expect(instance.mesh).toBe(source.mesh);
        expect(instance.materialId).toBe("mat-a");
        expect(copy.transform.equals(Matrix4.fromTranslation(11, 0, 0))).toBe(true);
        expect(copy.boundingBox()!.min.x).toBeCloseTo(11);
        expect(doc.modelManager.findNode((x) => x.id === source.id)).toBe(source);
    });

    test("retargets to a replacement node and drops the cached source", () => {
        const { doc, source } = scene();
        const instance = MeshInstanceNode.fromSource(source, Matrix4.identity());
        doc.modelManager.addNode(instance);
        expect(instance.source).toBe(source);

        const replacement = new MeshNode({ document: doc, name: "replacement", mesh: surface() });
        doc.modelManager.addNode(replacement);

        expect(retargetInstanceSources(doc, source.id, replacement.id)).toBe(1);
        expect(instance.sourceId).toBe(replacement.id);
        expect(instance.source).toBe(replacement);
        expect(instance.warningCount).toBe(0);

        // History undo assigns through the public setter; the cached source must drop.
        instance.sourceId = source.id;
        expect(instance.sourceId).toBe(source.id);
        expect(instance.source).toBe(source);
    });

    test("reports a source only while a surviving instance still reads it", () => {
        const { doc, source } = scene();
        const other = new MeshNode({ document: doc, name: "other", mesh: surface() });
        doc.modelManager.addNode(other);
        const instance = MeshInstanceNode.fromSource(source, Matrix4.identity());
        doc.modelManager.addNode(instance);

        expect(instanceSourcesInUse(doc, [source])).toEqual(new Set([source.id]));
        expect(instanceSourcesInUse(doc, [other])).toEqual(new Set());

        // Removing the instance together with its source is not a dangling reference.
        expect(instanceSourcesInUse(doc, [source, instance])).toEqual(new Set());
    });

    test("expands the removed subtree, so a nested source still counts", () => {
        const doc = new TestDocument();
        // Not linked into the root list, so the fake wrapper owns only this child.
        const nested = new MeshNode({ document: doc, name: "nested", mesh: surface() });
        const instance = MeshInstanceNode.fromSource(nested, Matrix4.identity());
        doc.modelManager.addNode(instance);
        // A folder-like wrapper: `add` marks it as a linked-list node, `firstChild` the
        // child that disappears with it.
        const folder = {
            id: "folder",
            add: () => {},
            firstChild: nested,
            nextSibling: undefined,
        } as any;

        expect(instanceSourcesInUse(doc, [folder])).toEqual(new Set([nested.id]));
    });

    test("warns while the source is missing and clears when it appears", () => {
        const doc = new TestDocument();
        const source = new MeshNode({ document: doc, name: "mesh", mesh: surface() });
        const instance = new MeshInstanceNode({
            document: doc,
            sourceId: source.id,
            name: "instance",
        });
        doc.modelManager.addNode(instance);

        expect(instance.warningCount).toBe(1);
        expect(instance.warningTooltip).toBe("body.instance.sourceMissing");

        doc.modelManager.addNode(source);
        expect(instance.warningCount).toBe(0);

        source.dispose();
        expect(instance.warningCount).toBe(1);
    });

    test("copying an instance copies its placement, not a nested instance", () => {
        const { doc, source } = scene();
        const instance = MeshInstanceNode.fromSource(source, Matrix4.fromTranslation(10, 0, 0));
        doc.modelManager.addNode(instance);

        const copy = cloneForCopyNode(instance, Matrix4.fromTranslation(0, 5, 0)) as MeshInstanceNode;

        expect(copy.source).toBe(source);
        expect(copy.transform.equals(Matrix4.fromTranslation(10, 5, 0))).toBe(true);
    });

    test("serializes the source reference but not the mesh", () => {
        const { doc, source } = scene();
        const instance = MeshInstanceNode.fromSource(source, Matrix4.fromTranslation(0, 5, 0));

        const data = Serializer.serializeObject(instance);

        expect("mesh" in data).toBe(false);
        expect(data["sourceId"]).toBe(source.id);
        const restored = Serializer.deserializeObject(doc, data) as MeshInstanceNode;
        expect(restored).toBeInstanceOf(MeshInstanceNode);
        expect(restored.sourceId).toBe(source.id);
        expect(restored.transform.equals(Matrix4.fromTranslation(0, 5, 0))).toBe(true);
        expect(restored.mesh).toBe(source.mesh);
    });

    test("a plain solid copies as a body instance", () => {
        const doc = new TestDocument();
        const solid = new EditableShapeNode({
            document: doc,
            name: "solid",
            shape: createMockShape(),
        });
        doc.modelManager.addNode(solid);

        const copy = cloneForCopyNode(solid, Matrix4.identity());

        expect(copy).toBeInstanceOf(BodyInstanceNode);
        expect(isInstanceNode(copy)).toBe(true);
        expect((copy as BodyInstanceNode).source).toBe(solid);
    });
});
