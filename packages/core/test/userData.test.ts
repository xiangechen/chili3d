// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    type EdgeMeshData,
    EditableShapeNode,
    FolderNode,
    type IDisposable,
    Result,
    Serializer,
    ShapeTypes,
    Transaction,
    UserData,
    VisualConfig,
} from "../src";
import { MockShape, TestDocument } from "../test-utils";

function auxEdgeMesh(color: number): EdgeMeshData {
    return {
        position: new Float32Array([0, 0, 0, 2, 0, 0]),
        range: [{ start: 0, count: 2, shape: {} as any }],
        lineType: "dash",
        color,
    };
}

describe("UserData", () => {
    test("with returns a new bag, leaving the original untouched", () => {
        const bag = new UserData();
        const next = bag.with("k", 1);

        expect(bag.get("k")).toBeUndefined();
        expect(next.get("k")).toBe(1);
        expect(next.size).toBe(1);
    });

    test("without removes the key; a missing key returns the same bag", () => {
        const bag = new UserData({ a: 1, b: 2 });

        const without = bag.without("a");
        expect(without.get("a")).toBeUndefined();
        expect(without.get("b")).toBe(2);
        expect(bag.without("missing")).toBe(bag);
    });

    test("dispose releases disposable values once", () => {
        let disposed = 0;
        const value: IDisposable = { dispose: () => disposed++ };
        const bag = new UserData({ v: value, plain: 1 });

        bag.dispose();
        bag.dispose();

        expect(disposed).toBe(1);
    });

    test("serializes primitive entries and round-trips them", () => {
        const doc = new TestDocument() as any;
        const bag = new UserData({ label: "ref", count: 3, flag: true });

        const restored = Serializer.deserializeObject(doc, Serializer.serializeObject(bag)) as UserData;

        expect(restored).toBeInstanceOf(UserData);
        expect(restored.entries).toEqual({ label: "ref", count: 3, flag: true });
    });

    test("serialization drops undefined entries", () => {
        const doc = new TestDocument() as any;
        const bag = new UserData({ gone: undefined, kept: 1 });

        const restored = Serializer.deserializeObject(doc, Serializer.serializeObject(bag)) as UserData;

        expect(restored.entries).toEqual({ kept: 1 });
    });

    test("a user entry named 'document' round-trips", () => {
        const doc = new TestDocument() as any;
        const bag = new UserData({ document: "user-value" });

        const restored = Serializer.deserializeObject(doc, Serializer.serializeObject(bag)) as UserData;

        expect(restored.get("document")).toBe("user-value");
    });

    test("disposeExcept spares the values a surviving bag still holds", () => {
        let sharedDisposed = 0;
        let staleOnlyDisposed = 0;
        const shared: IDisposable = { dispose: () => sharedDisposed++ };
        const staleOnly: IDisposable = { dispose: () => staleOnlyDisposed++ };
        const live = new UserData({ aux: shared });
        const stale = live.with("temp", staleOnly);

        stale.disposeExcept(live);

        expect(sharedDisposed).toBe(0);
        expect(staleOnlyDisposed).toBe(1);

        // the stale bag is spent either way — a later plain dispose frees nothing again
        stale.dispose();
        expect(sharedDisposed).toBe(0);
        expect(staleOnlyDisposed).toBe(1);
    });
});

describe("Node.userData", () => {
    test("writes replace the bag immutably, `without` deletes the key", () => {
        const doc = new TestDocument();
        const node = new FolderNode({ document: doc, name: "n" });

        node.userData = node.userData.with("k", 42);
        expect(node.userData.get("k")).toBe(42);

        const before = node.userData;
        node.userData = node.userData.without("k");
        expect(node.userData.get("k")).toBeUndefined();
        // immutable replacement: the previous bag still holds the value
        expect(before.get("k")).toBe(42);
    });

    test("userData changes undo and redo with the transaction", () => {
        const doc = new TestDocument();
        const node = new FolderNode({ document: doc, name: "n" });

        Transaction.execute(doc, "set userData", () => {
            node.userData = node.userData.with("k", 1);
        });
        expect(node.userData.get("k")).toBe(1);

        doc.history.undo();
        expect(node.userData.get("k")).toBeUndefined();

        doc.history.redo();
        expect(node.userData.get("k")).toBe(1);
    });

    test("userData survives node serialization", () => {
        const doc = new TestDocument() as any;
        const node = new FolderNode({ document: doc, name: "n" });
        node.userData = node.userData.with("label", "construction");

        const restored = Serializer.deserializeObject(doc, Serializer.serializeObject(node)) as FolderNode;

        expect(restored.userData.get("label")).toBe("construction");
    });

    test("disposing the node disposes the userData bag", () => {
        const doc = new TestDocument();
        const node = new FolderNode({ document: doc, name: "n" });
        let disposed = 0;
        node.userData = node.userData.with("v", { dispose: () => disposed++ });

        node.dispose();

        expect(disposed).toBe(1);
    });

    test("dropping a redo branch keeps the values the live bag still holds", () => {
        const doc = new TestDocument();
        const node = new FolderNode({ document: doc, name: "n" });
        let sharedDisposed = 0;
        let staleOnlyDisposed = 0;
        node.userData = node.userData.with("aux", { dispose: () => sharedDisposed++ });

        Transaction.execute(doc, "change", () => {
            node.userData = node.userData.with("k", { dispose: () => staleOnlyDisposed++ });
        });
        doc.history.undo();

        // a fresh change discards the redo branch and its record with it
        Transaction.execute(doc, "other", () => {
            node.userData = node.userData.with("x", 2);
        });

        // the dropped bag shared `aux` with the live one; only its own value may be freed
        expect(sharedDisposed).toBe(0);
        expect(staleOnlyDisposed).toBe(1);
        expect(node.userData.get("aux")).toBeDefined();
    });
});

describe("ShapeNode.setExtraDisplayEdges", () => {
    function shapeNode() {
        const doc = new TestDocument();
        const shape = new MockShape({ shapeType: ShapeTypes.solid });
        const node = new EditableShapeNode({ document: doc, name: "n", shape: Result.ok(shape) });
        return { node, shape };
    }

    test("extra edges merge into mesh.edges without touching the shape's own mesh", () => {
        const { node, shape } = shapeNode();
        const ownEdges = shape.mesh.edges!;
        const ownRangeCount = ownEdges.range.length;

        node.setExtraDisplayEdges([auxEdgeMesh(0x102030)]);

        const merged = node.mesh.edges!;
        expect(merged.position.length).toBe(ownEdges.position.length + 6);
        expect(merged.range.length).toBe(ownRangeCount + 1);
        // the extra range is rebased behind the node's own vertices
        expect(merged.range[ownRangeCount].start).toBe(ownEdges.position.length / 3);
        // the shape's own mesh is untouched
        expect(shape.mesh.edges!.range.length).toBe(ownRangeCount);
        // different colours expand to per-vertex RGB triples
        expect(Array.isArray(merged.color)).toBe(true);
        expect((merged.color as number[]).length).toBe(merged.position.length);
    });

    test("same-colour extras keep the single colour form", () => {
        const { node } = shapeNode();

        node.setExtraDisplayEdges([auxEdgeMesh(VisualConfig.defaultEdgeColor)]);

        expect(node.mesh.edges!.color).toBe(VisualConfig.defaultEdgeColor);
    });

    test("clearing restores the shape's own edge mesh", () => {
        const { node, shape } = shapeNode();
        node.setExtraDisplayEdges([auxEdgeMesh(0x102030)]);

        node.setExtraDisplayEdges(undefined);

        expect(node.extraDisplayEdges).toBeUndefined();
        expect(node.mesh.edges).toBe(shape.mesh.edges);
    });

    test("an empty array clears like undefined", () => {
        const { node } = shapeNode();
        node.setExtraDisplayEdges([auxEdgeMesh(0x102030)]);

        node.setExtraDisplayEdges([]);

        expect(node.extraDisplayEdges).toBeUndefined();
        expect(node.mesh.edges!.range.length).toBe(1);
    });

    test("a userData change keeps the cached mesh; refreshMesh rebuilds it", () => {
        const { node } = shapeNode();
        node.setExtraDisplayEdges([auxEdgeMesh(0x102030)]);
        const meshBefore = node.mesh;

        node.userData = node.userData.with("k", 1);
        expect(node.mesh).toBe(meshBefore);

        node.refreshMesh();
        expect(node.mesh).not.toBe(meshBefore);
    });
});
