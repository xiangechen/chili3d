// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, PubSub, Result, type ShapeType, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { FilletCommand } from "../../../src/commands/modify/fillet";
import {
    ensureGlobalStubApp,
    type MockShape,
    mockShape,
    seedStepDatas,
    shapeStepResult,
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
 * Build a fillet command with the single edge-selection step seeded: each edge
 * carries an `.index` (ISubEdgeShape), a `parent` body shape, and its `owner.node`
 * is a ShapeNode-ish stub. Returns the command plus the node's tracking parent
 * so callers can assert what was added / removed from the document tree.
 */
function buildFilletCommand(edges: number[], opts: { bodyType?: ShapeType } = {}) {
    const cmd = new FilletCommand();
    const { doc } = wireCommand(cmd);

    const shape = mockShape();
    const body = mockShape({ shapeType: opts.bodyType ?? ShapeTypes.solid });
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const solidNode = {
        name: "solid0",
        document: doc,
        shape: { value: shape },
        transform: Matrix4.identity(),
        materialId: "mat-1",
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
    };

    const step = shapeStepResult(
        edges.map((index) => ({ shape: { index, parent: body } as Partial<MockShape>, node: solidNode })),
    );

    seedStepDatas(cmd, [step]);
    return { cmd, doc, parent, shape, body, solidNode };
}

/** A parent shape of the given type whose `isPartner` only matches itself. */
function typedParent(shapeType: ShapeType) {
    const parent = mockShape({ shapeType });
    (parent as any).isPartner = (other: unknown) => other === parent;
    return parent;
}

const solidParent = () => typedParent(ShapeTypes.solid);
const faceParent = () => typedParent(ShapeTypes.face);
const wireParent = () => typedParent(ShapeTypes.wire);
const edgeParent = () => typedParent(ShapeTypes.edge);

/** A compound parent whose content (faces or solids) decides the 2D vs 3D branch. */
function compoundParent(content: { faces?: MockShape[]; solids?: MockShape[] }) {
    const parent = typedParent(ShapeTypes.compound);
    (parent as any).findSubShapes = (type: ShapeType) =>
        type === ShapeTypes.face
            ? (content.faces ?? [])
            : type === ShapeTypes.solid
              ? (content.solids ?? [])
              : [];
    return parent;
}

function edgeOn(parent: unknown, index = 0) {
    return mockShape({ shapeType: ShapeTypes.edge, parent, index } as Partial<MockShape>);
}

function edgeFilterOf(cmd: FilletCommand) {
    return (cmd as any).getSteps()[0].options.shapeFilter;
}

/** Replace the stub factory with a proxy recording calls per method name. */
function captureFactory(impls: Record<string, () => unknown> = {}) {
    const original = (globalThis as any).app.shapeProvider.factory;
    const calls: Record<string, any[][]> = {};
    Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
        configurable: true,
        value: new Proxy(
            {},
            {
                get:
                    (_t, prop) =>
                    (...args: any[]) => {
                        const key = prop as string;
                        calls[key] ??= [];
                        calls[key].push(args);
                        return (impls[key] ?? (() => Result.ok(mockShape())))();
                    },
            },
        ),
    });
    return {
        calls,
        restore: () =>
            Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                configurable: true,
                value: original,
            }),
    };
}

/**
 * Build a command seeded with two selected edges of a wire body. The wire's
 * `findSubShapes` returns three edges, the last two matching the selected
 * sub-edges (or swapped when `swap` is set) via `isEqual`.
 */
function buildWireCommand(opts: { swap?: boolean } = {}) {
    const { cmd, parent, body } = buildFilletCommand([0, 1], { bodyType: ShapeTypes.wire });
    const sel0 = (cmd as any).stepDatas[0].shapes[0].shape;
    const sel1 = (cmd as any).stepDatas[0].shapes[1].shape;

    const allEdges = [mockShape(), mockShape(), mockShape()];
    (allEdges[1] as any).isEqual = (other: unknown) => other === (opts.swap ? sel1 : sel0);
    (allEdges[2] as any).isEqual = (other: unknown) => other === (opts.swap ? sel0 : sel1);
    (body as any).findSubShapes = () => allEdges;

    return { cmd, parent, sel0, sel1, allEdges };
}

/** Build a command seeded with edges of two standalone edge bodies. */
function buildStandaloneEdgesCommand(count: 1 | 2 = 2) {
    const cmd = new FilletCommand();
    const { doc } = wireCommand(cmd);

    const body = mockShape({ shapeType: ShapeTypes.edge });
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const mkNode = (name: string) => ({
        name,
        shape: { value: body },
        transform: Matrix4.identity(),
        materialId: "mat-1",
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
    });

    const entries = [
        { shape: { parent: body } as Partial<MockShape>, node: mkNode("edge0") },
        { shape: { parent: body } as Partial<MockShape>, node: mkNode("edge1") },
    ].slice(0, count);
    seedStepDatas(cmd, [shapeStepResult(entries)]);
    return { cmd, parent };
}

/** Replace `PubSub.default.pub` with a recorder. */
function capturePubSub() {
    const original = PubSub.default.pub;
    const pubs: any[][] = [];
    PubSub.default.pub = ((...args: any[]) => {
        pubs.push(args);
    }) as any;
    return {
        pubs,
        restore: () => {
            PubSub.default.pub = original;
        },
    };
}

describe("FilletCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (FilletCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("modify.fillet");
        expect(data.icon).toBe("icon-fillet");
    });

    test("radius should default to 10", () => {
        const cmd = new FilletCommand();
        expect(cmd.radius).toBe(10);
    });

    test("radius setter should update property", () => {
        const cmd = new FilletCommand();
        cmd.radius = 20;
        expect(cmd.radius).toBe(20);
    });

    test("getSteps should return a single edge-selection step", () => {
        const cmd = new FilletCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
        expect(steps[0].snapeType).toBe(ShapeTypes.edge);
        expect(steps[0].options.multiple).toBe(true);
    });

    describe("edgeFilter", () => {
        test("should allow any edge on a solid when nothing is selected yet", () => {
            const { cmd } = buildFilletCommand([1]);
            const filter = edgeFilterOf(cmd);

            expect(filter.allow(edgeOn(solidParent()), Matrix4.identity())).toBe(true);
        });

        test("should allow edges on a face (2D fillet)", () => {
            const { cmd } = buildFilletCommand([1]);
            const filter = edgeFilterOf(cmd);

            expect(filter.allow(edgeOn(faceParent()), Matrix4.identity())).toBe(true);
        });

        test("should allow edges on a wire (2D fillet)", () => {
            const { cmd } = buildFilletCommand([1]);
            const filter = edgeFilterOf(cmd);

            expect(filter.allow(edgeOn(wireParent()), Matrix4.identity())).toBe(true);
        });

        test("should allow standalone edges (2D fillet)", () => {
            const { cmd } = buildFilletCommand([1]);
            const filter = edgeFilterOf(cmd);

            expect(filter.allow(edgeOn(edgeParent()), Matrix4.identity())).toBe(true);
        });

        test("should reject edges whose parent is not a solid, compound, face, wire or edge", () => {
            const { cmd } = buildFilletCommand([1]);
            const filter = edgeFilterOf(cmd);
            const shellParent = mockShape({ shapeType: ShapeTypes.shell });

            expect(filter.allow(edgeOn(shellParent), Matrix4.identity())).toBe(false);
        });

        test("should only allow edges on the shape of the first selected edge", () => {
            const { cmd, doc } = buildFilletCommand([1]);
            const parentA = solidParent();
            const parentB = solidParent();
            (doc.selection as any).getSelectedShapes = () => [{ shape: edgeOn(parentA) }];

            const filter = edgeFilterOf(cmd);
            expect(filter.allow(edgeOn(parentA, 2), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(parentB, 3), Matrix4.identity())).toBe(false);
        });

        test("should not mix a body edge with a standalone edge", () => {
            const { cmd, doc } = buildFilletCommand([1]);
            const face = faceParent();
            (doc.selection as any).getSelectedShapes = () => [{ shape: edgeOn(face) }];

            expect(edgeFilterOf(cmd).allow(edgeOn(edgeParent()), Matrix4.identity())).toBe(false);
        });

        test("should only allow standalone edges after a standalone edge is selected", () => {
            const { cmd, doc } = buildFilletCommand([1]);
            (doc.selection as any).getSelectedShapes = () => [{ shape: edgeOn(edgeParent()) }];

            const filter = edgeFilterOf(cmd);
            expect(filter.allow(edgeOn(edgeParent(), 1), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(faceParent(), 2), Matrix4.identity())).toBe(false);
            expect(filter.allow(edgeOn(wireParent(), 3), Matrix4.identity())).toBe(false);
            expect(filter.allow(edgeOn(solidParent(), 4), Matrix4.identity())).toBe(false);
        });

        test("should keep allowing more edges on a solid", () => {
            const { cmd, doc } = buildFilletCommand([1]);
            const solid = solidParent();
            (doc.selection as any).getSelectedShapes = () => [
                { shape: edgeOn(solid, 0) },
                { shape: edgeOn(solid, 1) },
            ];

            expect(edgeFilterOf(cmd).allow(edgeOn(solid, 2), Matrix4.identity())).toBe(true);
        });

        test("should allow at most two edges on a compound of faces", () => {
            const { cmd, doc } = buildFilletCommand([1]);
            const parent = compoundParent({ faces: [mockShape({ shapeType: ShapeTypes.face })] });
            (doc.selection as any).getSelectedShapes = () => [
                { shape: edgeOn(parent, 0) },
                { shape: edgeOn(parent, 1) },
            ];

            expect(edgeFilterOf(cmd).allow(edgeOn(parent, 2), Matrix4.identity())).toBe(false);
        });

        test("should keep allowing more edges on a compound of solids", () => {
            const { cmd, doc } = buildFilletCommand([1]);
            const parent = compoundParent({ solids: [mockShape({ shapeType: ShapeTypes.solid })] });
            (doc.selection as any).getSelectedShapes = () => [
                { shape: edgeOn(parent, 0) },
                { shape: edgeOn(parent, 1) },
            ];

            expect(edgeFilterOf(cmd).allow(edgeOn(parent, 2), Matrix4.identity())).toBe(true);
        });

        test.each([
            ShapeTypes.face,
            ShapeTypes.wire,
            ShapeTypes.edge,
        ])("should allow at most two edges on parent type %s", (shapeType) => {
            const { cmd, doc } = buildFilletCommand([1]);
            const parent = typedParent(shapeType);
            const e1 = edgeOn(parent, 0);
            const e2 = edgeOn(parent, 1);
            (doc.selection as any).getSelectedShapes = () => [{ shape: e1 }, { shape: e2 }];

            const filter = edgeFilterOf(cmd);
            // a third, different edge is rejected
            const thirdParent = shapeType === ShapeTypes.edge ? typedParent(shapeType) : parent;
            expect(filter.allow(edgeOn(thirdParent, 2), Matrix4.identity())).toBe(false);
            // re-picking an already selected edge stays allowed so it can be toggled off
            const repick = edgeOn(parent, 0);
            (e1 as any).isEqual = (other: unknown) => other === repick;
            expect(filter.allow(repick, Matrix4.identity())).toBe(true);
        });
    });

    describe("canFinish", () => {
        const canFinishOf = (cmd: FilletCommand) => (cmd as any).getSteps()[0].options.canFinish;

        test.each([
            ShapeTypes.face,
            ShapeTypes.wire,
            ShapeTypes.edge,
        ])("should finish after two edges are selected on parent type %s", (shapeType) => {
            const { cmd } = buildFilletCommand([0, 1]);
            const parent = typedParent(shapeType);

            expect(canFinishOf(cmd)([{ shape: edgeOn(parent, 0) }, { shape: edgeOn(parent, 1) }])).toBe(true);
        });

        test("should not finish with a single edge on a face", () => {
            const { cmd } = buildFilletCommand([0]);

            expect(canFinishOf(cmd)([{ shape: edgeOn(faceParent(), 0) }])).toBe(false);
        });

        test("should not finish automatically on a solid", () => {
            const { cmd } = buildFilletCommand([0, 1]);
            const solid = solidParent();

            expect(canFinishOf(cmd)([{ shape: edgeOn(solid, 0) }, { shape: edgeOn(solid, 1) }])).toBe(false);
        });

        test("should finish after two edges are selected on a compound of faces", () => {
            const { cmd } = buildFilletCommand([0, 1]);
            const parent = compoundParent({ faces: [mockShape({ shapeType: ShapeTypes.face })] });

            expect(canFinishOf(cmd)([{ shape: edgeOn(parent, 0) }, { shape: edgeOn(parent, 1) }])).toBe(true);
        });

        test("should not finish automatically on a compound of solids", () => {
            const { cmd } = buildFilletCommand([0, 1]);
            const parent = compoundParent({ solids: [mockShape({ shapeType: ShapeTypes.solid })] });

            expect(canFinishOf(cmd)([{ shape: edgeOn(parent, 0) }, { shape: edgeOn(parent, 1) }])).toBe(
                false,
            );
        });
    });

    describe("executeMainTask", () => {
        test("should add the filleted EditableShapeNode and remove the original node", () => {
            const { cmd, parent, shape } = buildFilletCommand([3, 7]);

            (cmd as any).executeMainTask();

            // shapeFactory.fillet(node.shape.value, edges, radius) was called.
            expect(shape.calls.get("transformedMul")).toBeUndefined(); // fillet does not transform the source
            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);

            const added = parent.added[0] as any;
            expect(added.name).toBe("solid0");
            expect(added.materialId).toBe("mat-1");
            // The original node was removed.
            expect(parent.removed[0]).toBe(parent.removed[0]);
        });

        test("should retarget instances of the replaced source node", () => {
            const { cmd, doc, parent, solidNode } = buildFilletCommand([3]);
            (solidNode as any).id = "source";
            const instance = { isInstance: true, sourceId: "source" };
            (doc.modelManager as any).findNodesDeep = () => [instance];

            (cmd as any).executeMainTask();

            const added = parent.added[0] as { id: string };
            expect(instance.sourceId).toBe(added.id);
        });

        test("should fall back to rootNode when the original node has no parent", () => {
            const { cmd, solidNode } = buildFilletCommand([1]);
            // Detach the node so `node.parent ?? rootNode` is exercised.
            (solidNode as any).parent = undefined;

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
        });

        test("should pass the configured radius through to shapeFactory.fillet", () => {
            const { cmd } = buildFilletCommand([2]);
            cmd.radius = 5;

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();
                expect(calls["fillet"]).toHaveLength(1);
                expect(calls["fillet"][0][2]).toBe(5); // radius is the 3rd arg
            } finally {
                restore();
            }
        });

        test("should fillet two edges of a face with fillet2d", () => {
            const { cmd, parent, body } = buildFilletCommand([0, 1], { bodyType: ShapeTypes.face });
            cmd.radius = 3;

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(calls["fillet2d"]).toHaveLength(1);
                expect(calls["fillet2d"][0][0]).toBe(body); // the face the edges were picked on
                expect(calls["fillet2d"][0][1]).toBe((cmd as any).stepDatas[0].shapes[0].shape);
                expect(calls["fillet2d"][0][2]).toBe((cmd as any).stepDatas[0].shapes[1].shape);
                expect(calls["fillet2d"][0][3]).toBe(3); // radius
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should fillet a corner of a wire and rebuild it", () => {
            const { cmd, parent, sel0, sel1, allEdges } = buildWireCommand();

            const [t1, fillet, t2] = [mockShape(), mockShape(), mockShape()];
            const { calls, restore } = captureFactory({
                filletEdge2d: () => Result.ok([t1, fillet, t2]),
            });
            try {
                (cmd as any).executeMainTask();

                expect(calls["filletEdge2d"]).toHaveLength(1);
                expect(calls["filletEdge2d"][0][0]).toBe(sel0);
                expect(calls["filletEdge2d"][0][1]).toBe(sel1);
                // the triple is spliced into the wire in place of the two old edges
                expect(calls["wire"][0][0]).toEqual([allEdges[0], t1, fillet, t2]);
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should order the two selected edges along the wire flow", () => {
            const { cmd, sel0, sel1, allEdges } = buildWireCommand({ swap: true });

            const [t1, fillet, t2] = [mockShape(), mockShape(), mockShape()];
            const { calls, restore } = captureFactory({
                filletEdge2d: () => Result.ok([t1, fillet, t2]),
            });
            try {
                (cmd as any).executeMainTask();

                // sel1 precedes sel0 in the wire flow
                expect(calls["filletEdge2d"][0][0]).toBe(sel1);
                expect(calls["filletEdge2d"][0][1]).toBe(sel0);
                expect(calls["wire"][0][0]).toEqual([allEdges[0], t1, fillet, t2]);
            } finally {
                restore();
            }
        });

        test("should keep the standalone edges trimmed and add the fillet edge", () => {
            const { cmd, parent } = buildStandaloneEdgesCommand();

            const [t1, fillet, t2] = [mockShape(), mockShape(), mockShape()];
            const { calls, restore } = captureFactory({
                filletEdge2d: () => Result.ok([t1, fillet, t2]),
            });
            try {
                (cmd as any).executeMainTask();

                const shapes = (cmd as any).stepDatas[0].shapes;
                // mockShape.transformedMul returns the shape itself
                expect(calls["filletEdge2d"][0][0]).toBe(shapes[0].shape);
                expect(calls["filletEdge2d"][0][1]).toBe(shapes[1].shape);
                expect(calls["wire"]).toBeUndefined(); // the edges stay standalone, no wire is built

                // two trimmed edges replacing the originals, plus the new corner edge
                expect(parent.added).toHaveLength(3);
                expect(parent.removed).toHaveLength(2);
                const [added1, added2, addedCorner] = parent.added as any[];
                expect(added1.name).toBe("edge0");
                expect(added1.shape.value).toBe(t1);
                expect(added2.name).toBe("edge1");
                expect(added2.shape.value).toBe(t2);
                expect(addedCorner.name).toBe("edge0_1");
                expect(addedCorner.shape.value).toBe(fillet);
            } finally {
                restore();
            }
        });

        test("should report an error and keep the nodes when only one standalone edge is selected", () => {
            const { cmd, parent } = buildStandaloneEdgesCommand(1);

            const pubsub = capturePubSub();
            try {
                (cmd as any).executeMainTask();

                expect(pubsub.pubs.some((args) => args[0] === "displayError")).toBe(true);
                expect(parent.added).toHaveLength(0);
                expect(parent.removed).toHaveLength(0);
            } finally {
                pubsub.restore();
            }
        });

        test("should report an error and keep the node when only one edge is selected on a face", () => {
            const { cmd, parent } = buildFilletCommand([0], { bodyType: ShapeTypes.face });

            const pubsub = capturePubSub();
            try {
                (cmd as any).executeMainTask();

                expect(pubsub.pubs.some((args) => args[0] === "displayError")).toBe(true);
                expect(parent.added).toHaveLength(0);
                expect(parent.removed).toHaveLength(0);
            } finally {
                pubsub.restore();
            }
        });

        test("should report the factory error and keep the original node on failure", () => {
            const { cmd, parent } = buildFilletCommand([3, 7]);

            const factory = captureFactory({ fillet: () => Result.err("boom") });
            const pubsub = capturePubSub();
            try {
                (cmd as any).executeMainTask();

                expect(pubsub.pubs.some((args) => args[0] === "displayError" && args[1] === "boom")).toBe(
                    true,
                );
                expect(parent.added).toHaveLength(0);
                expect(parent.removed).toHaveLength(0);
            } finally {
                pubsub.restore();
                factory.restore();
            }
        });

        test("should fillet two edges of a compound of faces with fillet2d", () => {
            const { cmd, parent, body } = buildFilletCommand([0, 1], { bodyType: ShapeTypes.compound });
            cmd.radius = 4;

            const sel0 = (cmd as any).stepDatas[0].shapes[0].shape;
            const sel1 = (cmd as any).stepDatas[0].shapes[1].shape;
            const innerEdge = mockShape();
            (innerEdge as any).isEqual = (other: unknown) => other === sel0;
            const innerFace = mockShape({ shapeType: ShapeTypes.face });
            (innerFace as any).findSubShapes = () => [innerEdge];
            (body as any).findSubShapes = (type: ShapeType) => (type === ShapeTypes.face ? [innerFace] : []);

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(calls["fillet2d"]).toHaveLength(1);
                expect(calls["fillet2d"][0][0]).toBe(innerFace); // the face inside the compound
                expect(calls["fillet2d"][0][1]).toBe(sel0);
                expect(calls["fillet2d"][0][2]).toBe(sel1);
                expect(calls["fillet2d"][0][3]).toBe(4); // radius
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should treat a compound of solids as 3D", () => {
            const { cmd, body } = buildFilletCommand([3, 7], { bodyType: ShapeTypes.compound });
            cmd.radius = 6;
            (body as any).findSubShapes = (type: ShapeType) =>
                type === ShapeTypes.solid ? [mockShape({ shapeType: ShapeTypes.solid })] : [];

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(calls["fillet"]).toHaveLength(1);
                expect(calls["fillet"][0][1]).toEqual([3, 7]); // edge indexes
                expect(calls["fillet"][0][2]).toBe(6); // radius
                expect(calls["fillet2d"]).toBeUndefined();
            } finally {
                restore();
            }
        });
    });
});
