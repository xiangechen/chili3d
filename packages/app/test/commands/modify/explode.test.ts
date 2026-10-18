// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, Matrix4, MultiShapeNode, PubSub, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { Explode } from "../../../src/commands/modify/explode";
import {
    ensureGlobalStubApp,
    type MockShape,
    makeParent,
    mockShape,
    nodeStepResult,
    seedStepDatas,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/**
 * The explode command mutates real node trees (GroupNode.add triggers
 * modelManager.notifyNodeChanged, etc.), so the mock document needs a couple of
 * extra no-op slots beyond what `wireCommand` provides by default.
 */
function wireExplodeCommand(cmd: Explode) {
    const { doc } = wireCommand(cmd);
    const mm = doc.modelManager as any;
    mm.notifyNodeChanged = () => {};
    mm.components = [];
    const ctx = doc.visual.context as any;
    ctx.redrawNode = () => {};
    ctx.getVisual = () => undefined;
    return { doc };
}

/** A mock shape whose directSubShapes returns the given list. */
function shapeWithSubShapes(subShapes: MockShape[]): MockShape {
    return mockShape({ directSubShapes: () => subShapes } as Partial<MockShape>);
}

describe("Explode", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (Explode as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("modify.explode");
        expect(data.icon).toBe("icon-explode");
    });

    test("getSteps should return one step", () => {
        const cmd = new Explode();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    describe("executeMainTask", () => {
        test("should be a no-op (and not throw) when no nodes are selected", () => {
            const cmd = new Explode();
            wireExplodeCommand(cmd);
            seedStepDatas(cmd, [{ nodes: undefined } as any]);

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
        });

        test("should dispatch a ShapeNode through explodeShapeNode and replace it when one sub-shape results", () => {
            const cmd = new Explode();
            const { doc } = wireExplodeCommand(cmd);
            const parent = makeParent({ id: "p" }) as TrackingParent;

            const subShape = mockShape();
            const sourceShape = shapeWithSubShapes([subShape]);
            const node = new EditableShapeNode({
                document: doc,
                name: "compound0",
                shape: sourceShape,
                materialId: "mat-1",
            });
            // Place the node into the tracking parent so insertAfter/remove are observable.
            (node as any).parent = parent;

            seedStepDatas(cmd, [nodeStepResult([node] as any)]);

            (cmd as any).executeMainTask();

            // One new EditableShapeNode was inserted after the previous sibling.
            expect(parent.insertedAfter).toHaveLength(1);
            expect((parent.insertedAfter[0] as any).node.name).toBe("compound0");
            // The original node was removed.
            expect(parent.removed).toHaveLength(1);
        });

        test("should group multiple sub-shapes under a GroupNode (explodeShapeNode branch)", () => {
            const cmd = new Explode();
            const { doc } = wireExplodeCommand(cmd);
            const parent = makeParent({ id: "p" }) as TrackingParent;

            const subShapes = [
                mockShape({ shapeType: ShapeTypes.solid }),
                mockShape({ shapeType: ShapeTypes.face }),
            ];
            const sourceShape = shapeWithSubShapes(subShapes);
            const node = new EditableShapeNode({
                document: doc,
                name: "compound1",
                shape: sourceShape,
            });
            (node as any).parent = parent;

            seedStepDatas(cmd, [nodeStepResult([node] as any)]);

            (cmd as any).executeMainTask();

            // The GroupNode is inserted after the original; the original is removed.
            expect(parent.insertedAfter).toHaveLength(1);
            const folder = (parent.insertedAfter[0] as any).node;
            // GroupNode is a real FolderNode: check its child count via the public API.
            expect(folder.count).toBe(2);
            expect(folder.children().map((c: any) => c.name)).toEqual(["Solid 1", "Face 2"]);
            expect(parent.removed).toHaveLength(1);
        });

        test("refuses to explode a node an instance reads", () => {
            const cmd = new Explode();
            const { doc } = wireExplodeCommand(cmd);
            const parent = makeParent({ id: "p" }) as TrackingParent;
            const node = new EditableShapeNode({
                document: doc,
                name: "compound0",
                shape: shapeWithSubShapes([mockShape()]),
            });
            (node as any).parent = parent;
            (doc.modelManager as any).findNodesDeep = () => [
                { id: "instance", isInstance: true, sourceId: node.id },
            ];
            seedStepDatas(cmd, [nodeStepResult([node] as any)]);
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});

            try {
                (cmd as any).executeMainTask();

                expect(pubSpy).toHaveBeenCalledWith("showToast", "toast.instance.sourceInUse");
                expect(parent.insertedAfter).toHaveLength(0);
                expect(parent.removed).toHaveLength(0);
            } finally {
                pubSpy.mockRestore();
            }
        });

        test("should clone each component node and remove the component (explodeComponentNode)", () => {
            // `explodeComponentNode` calls `node.clone()`, which routes through the
            // Serializer and requires registered decorators. We invoke the private
            // method directly with a ComponentNode-like mock to avoid that machinery.
            const cmd = new Explode();
            wireExplodeCommand(cmd);
            const parent = makeParent({ id: "p" }) as TrackingParent;

            const cloned = { name: "inner_copy", transform: Matrix4.identity() };
            const innerNode = {
                name: "inner",
                transform: Matrix4.identity(),
                clone: () => cloned,
                cloneTransformed: () => cloned,
            };
            const componentNode = {
                component: { nodes: [innerNode] },
                transform: Matrix4.identity(),
                parent,
                previousSibling: undefined,
            };

            (cmd as any).explodeComponentNode(componentNode);

            // The cloned node is inserted after the component; the component removed.
            expect(parent.insertedAfter).toHaveLength(1);
            expect((parent.insertedAfter[0] as any).node).toBe(cloned);
            expect(parent.removed).toHaveLength(1);
            expect(parent.removed[0]).toBe(componentNode);
        });

        test("should hand the component placement to the member's transform hook", () => {
            const cmd = new Explode();
            wireExplodeCommand(cmd);
            const parent = makeParent({ id: "p" }) as TrackingParent;

            const cloned = { name: "member_copy", transform: Matrix4.identity() };
            const cloneTransformed = rs.fn((_matrix: Matrix4) => cloned);
            const innerNode = {
                name: "member",
                transform: Matrix4.identity(),
                cloneTransformed,
            };
            const componentTransform = Matrix4.fromTranslation(10, 20, 30);
            const componentNode = {
                component: { nodes: [innerNode] },
                transform: componentTransform,
                parent,
                previousSibling: undefined,
            };

            (cmd as any).explodeComponentNode(componentNode);

            expect(cloneTransformed).toHaveBeenCalledWith(componentTransform);
            expect((parent.insertedAfter[0] as any).node).toBe(cloned);
        });

        test("should explode each shape of a MultiShapeNode into its own EditableShapeNode", () => {
            const cmd = new Explode();
            const { doc } = wireExplodeCommand(cmd);
            const parent = makeParent({ id: "p" }) as TrackingParent;

            const s1 = mockShape();
            const s2 = mockShape();
            const multi = new MultiShapeNode({
                document: doc,
                name: "multi0",
                shapes: [s1 as any, s2 as any],
            });
            multi.transform = Matrix4.identity();
            (multi as any).parent = parent;

            seedStepDatas(cmd, [nodeStepResult([multi] as any)]);

            (cmd as any).executeMainTask();

            // Two new nodes inserted (one per shape); the multi node removed.
            expect(parent.insertedAfter).toHaveLength(2);
            expect(parent.removed).toHaveLength(1);
            expect((parent.insertedAfter[0] as any).node.name).toBe("multi0");
            // Each shape was transformed into a new node exactly once.
            expect(s1.calls.get("transformed")).toHaveLength(1);
        });
    });
});
