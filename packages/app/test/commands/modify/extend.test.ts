// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, PubSub, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { ExtendCommand } from "../../../src/commands/modify/extend";
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
 * A trimmed line curve: `basisCurve`/`direction` make `CurveUtils.isTrimmed`
 * and `CurveUtils.isLine` pass; `value(u)` maps a basis parameter to a point.
 */
function lineCurve(start: XYZ, direction: XYZ, first: number, last: number) {
    return {
        basisCurve: { direction },
        firstParameter: () => first,
        lastParameter: () => last,
        value: (u: number) => start.add(direction.multiply(u - first)),
    };
}

/**
 * A trimmed circle curve in the XY plane: `basisCurve`/`center`/`radius` make
 * `CurveUtils.isCircle` pass; `value(u)` evaluates the point at angle u.
 */
function arcCurve(center: XYZ, radius: number, u1: number, u2: number) {
    return {
        basisCurve: { center, radius, axis: XYZ.unitZ },
        firstParameter: () => u1,
        lastParameter: () => u2,
        value: (u: number) => center.add(new XYZ({ x: radius * Math.cos(u), y: radius * Math.sin(u), z: 0 })),
    };
}

/** `parameter(point)` of a full-circle temporary edge spanning [from, from + 2π). */
function circleParameter(center: XYZ, from: number) {
    return (point: XYZ) => {
        let angle = Math.atan2(point.y - center.y, point.x - center.x);
        while (angle < from) angle += 2 * Math.PI;
        while (angle > from + 2 * Math.PI) angle -= 2 * Math.PI;
        return angle;
    };
}

/** A standalone edge-body parent or a wire parent whose `isPartner` only matches itself. */
function typedParent(shapeType: ShapeType) {
    const parent = mockShape({ shapeType });
    (parent as any).isPartner = (other: unknown) => other === parent;
    return parent;
}

interface TempEdgeSpec {
    /** Intersections returned by the temporary (maximal) edge's `intersect`. */
    intersections?: { point: XYZ; parameter: number }[];
    /** `parameter(point)` of the temporary (maximal) edge's curve. */
    curveParameter?: (point: XYZ) => number | undefined;
    /** Return undefined from `trim`, the kernel's answer to an empty parameter window. */
    trimUndefined?: boolean;
}

/**
 * The shape partial of a line or arc edge: `trim` records its arguments and
 * pushes the edge it returns into `created`, so tests can assert how the edge
 * was extended and which edges the wire was rebuilt from. The trimmed edges
 * expose the `intersect`/`curve.parameter` the temporary edges need.
 */
function curveEdgeData(
    parent: unknown,
    curve: unknown,
    trims: unknown[][],
    created: MockShape[],
    spec: TempEdgeSpec = {},
): Partial<IShape> {
    const c = curve as {
        firstParameter: () => number;
        lastParameter: () => number;
        value: (u: number) => XYZ;
    };
    return {
        shapeType: ShapeTypes.edge,
        parent,
        curve,
        startPoint: () => c.value(c.firstParameter()),
        endPoint: () => c.value(c.lastParameter()),
        trim: (...args: unknown[]) => {
            trims.push(args);
            if (spec.trimUndefined) return undefined;
            const edge = mockShape({
                shapeType: ShapeTypes.edge,
                parent,
                intersect: () => spec.intersections ?? [],
                curve: { parameter: (point: XYZ) => spec.curveParameter?.(point) },
            } as Partial<MockShape>);
            created.push(edge);
            return edge;
        },
    } as unknown as Partial<IShape>;
}

/** A plain wire-member edge mock with endpoints and an optional `isEqual` match. */
function wireMember(start: XYZ, end: XYZ, match?: unknown) {
    return mockShape({
        startPoint: () => start,
        endPoint: () => end,
        isEqual: (other: unknown) => other === match,
    } as Partial<MockShape>);
}

function edgeNode(name: string, parent: TrackingParent, body: unknown, document: unknown) {
    return {
        name,
        document,
        shape: { value: body },
        transform: Matrix4.identity(),
        materialId: "mat-1",
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
    };
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

/** Two perpendicular segments: [0,1] on the X axis and [1,2] on the vertical line x=3. */
const X_CURVE = () => lineCurve(XYZ.zero, XYZ.unitX, 0, 1);
const Y_CURVE = () => lineCurve(new XYZ({ x: 3, y: 1, z: 0 }), XYZ.unitY, 1, 2);

/**
 * A command seeded with two selected edges of a wire. The wire's
 * `findSubShapes` returns `allEdges`, where index 1 and 2 match the selected
 * sub-edges via `isEqual`.
 */
function buildWireCommand(opts: { curves?: [unknown, unknown]; specs?: [TempEdgeSpec, TempEdgeSpec] } = {}) {
    const cmd = new ExtendCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const wire = typedParent(ShapeTypes.wire);

    const trims: [unknown[][], unknown[][]] = [[], []];
    const created: MockShape[] = [];
    const [curve1, curve2] = opts.curves ?? [X_CURVE(), Y_CURVE()];
    const node = edgeNode("wire0", parent, wire, doc);
    seedStepDatas(cmd, [
        shapeStepResult([{ shape: curveEdgeData(wire, curve1, trims[0], created, opts.specs?.[0]), node }]),
        shapeStepResult([{ shape: curveEdgeData(wire, curve2, trims[1], created, opts.specs?.[1]), node }]),
    ]);

    const sel0 = (cmd as any).stepDatas[0].shapes[0].shape;
    const sel1 = (cmd as any).stepDatas[1].shapes[0].shape;
    // the diagonal shares X's first end (0,0) and Y's last end (3,2), so the
    // two picked edges can only move their other - free - ends
    const allEdges = [
        wireMember(XYZ.zero, new XYZ({ x: 3, y: 2, z: 0 })),
        wireMember(XYZ.zero, new XYZ({ x: 1, y: 0, z: 0 }), sel0),
        wireMember(new XYZ({ x: 3, y: 1, z: 0 }), new XYZ({ x: 3, y: 2, z: 0 }), sel1),
    ];
    (wire as any).findSubShapes = () => allEdges;

    return { cmd, doc, parent, wire, trims, created, allEdges, sel0, sel1 };
}

/** Builds the shape partial of one selected standalone edge. */
type EdgeFactory = (ctx: { body: unknown; trims: unknown[][]; created: MockShape[] }) => Partial<IShape>;

/** A command seeded with a standalone target edge and a standalone boundary edge. */
function buildStandaloneCommand(opts: { shapes?: [EdgeFactory, EdgeFactory] } = {}) {
    const cmd = new ExtendCommand();
    const { doc } = wireCommand(cmd);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const body = mockShape({ shapeType: ShapeTypes.edge });

    const trims: [unknown[][], unknown[][]] = [[], []];
    const created: MockShape[] = [];
    const factories: EdgeFactory[] = opts.shapes ?? [
        (ctx) => curveEdgeData(ctx.body, X_CURVE(), ctx.trims, ctx.created),
        (ctx) => curveEdgeData(ctx.body, Y_CURVE(), ctx.trims, ctx.created),
    ];
    seedStepDatas(
        cmd,
        factories.map((factory, i) =>
            shapeStepResult([
                {
                    shape: factory({ body, trims: trims[i], created }),
                    node: edgeNode(`edge${i}`, parent, body, doc),
                },
            ]),
        ),
    );

    return { cmd, doc, parent, trims, created };
}

describe("ExtendCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (ExtendCommand as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("modify.extend");
    });

    test("getSteps should return target and boundary edge-selection steps", () => {
        const cmd = new ExtendCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
        expect(steps[0].snapeType).toBe(ShapeTypes.edge);
        expect(steps[0].prompt).toBe("prompt.select.extendTarget");
        expect(steps[1].snapeType).toBe(ShapeTypes.edge);
        expect(steps[1].prompt).toBe("prompt.select.boundary");
    });

    test("modifyBoundary should default to true", () => {
        const cmd = new ExtendCommand();
        expect((cmd as any).modifyBoundary).toBe(true);
        (cmd as any).modifyBoundary = false;
        expect((cmd as any).modifyBoundary).toBe(false);
    });

    describe("edgeFilter", () => {
        const edgeOn = (parent: unknown) =>
            mockShape({ shapeType: ShapeTypes.edge, parent } as Partial<MockShape>);
        const filterOf = (cmd: ExtendCommand) => (cmd as any).getSteps()[0].options.shapeFilter;

        test("should allow wire and standalone edges but reject other parents", () => {
            const { cmd } = buildWireCommand();
            const filter = filterOf(cmd);

            expect(filter.allow(edgeOn(typedParent(ShapeTypes.wire)), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.edge)), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.face)), Matrix4.identity())).toBe(false);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.solid)), Matrix4.identity())).toBe(false);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.shell)), Matrix4.identity())).toBe(false);
        });
    });

    describe("boundaryFilter", () => {
        const edgeOn = (parent: unknown) =>
            mockShape({ shapeType: ShapeTypes.edge, parent } as Partial<MockShape>);
        const filterOf = (cmd: ExtendCommand) => (cmd as any).getSteps()[1].options.shapeFilter;

        test("should allow any standalone or wire edge as boundary", () => {
            const { cmd, wire } = buildWireCommand();
            const filter = filterOf(cmd);

            expect(filter.allow(edgeOn(wire), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.wire)), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.edge)), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.face)), Matrix4.identity())).toBe(false);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.solid)), Matrix4.identity())).toBe(false);
        });

        test("should reject the target edge as its own boundary", () => {
            const { cmd, wire, sel0 } = buildWireCommand();
            const filter = filterOf(cmd);

            const repick = edgeOn(wire);
            (repick as any).isEqual = (other: unknown) => other === sel0;
            expect(filter.allow(repick, Matrix4.identity())).toBe(false);
        });

        test("should allow a wire boundary after a standalone target edge", () => {
            const { cmd } = buildStandaloneCommand();
            const filter = filterOf(cmd);

            expect(filter.allow(edgeOn(typedParent(ShapeTypes.edge)), Matrix4.identity())).toBe(true);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.wire)), Matrix4.identity())).toBe(true);
        });

        test("should reject everything when no target edge was picked", () => {
            const cmd = new ExtendCommand();
            const filter = filterOf(cmd);

            expect(filter.allow(edgeOn(typedParent(ShapeTypes.edge)), Matrix4.identity())).toBe(false);
            expect(filter.allow(edgeOn(typedParent(ShapeTypes.wire)), Matrix4.identity())).toBe(false);
        });
    });

    describe("executeMainTask", () => {
        test("should extend two edges of a wire to their intersection and rebuild the wire", () => {
            const { cmd, parent, trims, created, allEdges } = buildWireCommand();

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                // X segment [0,1] extended to x=3, Y segment [1,2] extended to y=0
                expect(trims[0]).toEqual([[0, 3]]);
                expect(trims[1]).toEqual([[0, 2]]);

                expect(calls["wire"]).toHaveLength(1);
                expect(calls["wire"][0][0]).toEqual([allEdges[0], created[0], created[1]]);
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should keep the longer side when the intersection cuts an edge", () => {
            const longX = lineCurve(XYZ.zero, XYZ.unitX, 0, 4); // intersection at x=3 cuts it
            const { cmd, trims } = buildWireCommand({ curves: [longX, Y_CURVE()] });

            const { restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();
                expect(trims[0]).toEqual([[0, 3]]); // [0,3] is longer than [3,4]
                expect(trims[1]).toEqual([[0, 2]]);
            } finally {
                restore();
            }
        });

        test("should move the picked endpoint to the intersection when it cuts an edge", () => {
            const longX = lineCurve(XYZ.zero, XYZ.unitX, 0, 4); // intersection at x=3 cuts it
            const { cmd, trims } = buildWireCommand({ curves: [longX, Y_CURVE()] });
            (cmd as any).stepDatas[0].shapes[0].point = new XYZ({ x: 3.5, y: 0, z: 0 }); // picked near the free end x=4

            const { restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();
                expect(trims[0]).toEqual([[0, 3]]); // the picked (right) endpoint moved to x=3
                expect(trims[1]).toEqual([[0, 2]]);
            } finally {
                restore();
            }
        });

        test("should move the free endpoint when the picked endpoint is shared", () => {
            const longX = lineCurve(XYZ.zero, XYZ.unitX, 0, 4); // intersection at x=3 cuts it
            const { cmd, parent, trims } = buildWireCommand({ curves: [longX, Y_CURVE()] });
            (cmd as any).stepDatas[0].shapes[0].point = new XYZ({ x: 0.5, y: 0, z: 0 }); // picked near the shared end x=0

            const { restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                // the shared end at x=0 anchors the edge, the free end moves to x=3
                expect(trims[0]).toEqual([[0, 3]]);
                expect(trims[1]).toEqual([[0, 2]]);
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should move the free endpoint to the corner beyond the shared end", () => {
            const { cmd, wire, sel0, sel1, parent, trims, created } = buildWireCommand();
            // the third edge shares X's last end (1,0): it anchors the edge while the
            // free end moves to the corner at x=3
            const allEdges = [
                wireMember(new XYZ({ x: 1, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })),
                wireMember(XYZ.zero, new XYZ({ x: 1, y: 0, z: 0 }), sel0),
                wireMember(new XYZ({ x: 3, y: 1, z: 0 }), new XYZ({ x: 3, y: 2, z: 0 }), sel1),
            ];
            (wire as any).findSubShapes = () => allEdges;

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(trims[0]).toEqual([[1, 3]]); // from the anchor (1,0) to the corner (3,0)
                expect(trims[1]).toEqual([[0, 2]]);
                expect(calls["wire"]).toHaveLength(1);
                expect(calls["wire"][0][0]).toEqual([allEdges[0], created[0], allEdges[2]]);
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should report an error when both endpoints are shared", () => {
            const { cmd, wire, sel0, sel1, parent } = buildWireCommand();
            // the third edge shares both ends of the X edge, so its range cannot change
            (wire as any).findSubShapes = () => [
                wireMember(XYZ.zero, new XYZ({ x: 1, y: 0, z: 0 })),
                wireMember(XYZ.zero, new XYZ({ x: 1, y: 0, z: 0 }), sel0),
                wireMember(new XYZ({ x: 3, y: 1, z: 0 }), new XYZ({ x: 3, y: 2, z: 0 }), sel1),
            ];

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

        test("should report an error for parallel wire edges and keep the node", () => {
            const parallel = lineCurve(new XYZ({ x: 0, y: 5, z: 0 }), XYZ.unitX, 0, 2);
            const { cmd, parent } = buildWireCommand({ curves: [X_CURVE(), parallel] });

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

        test("should report an error for non-coplanar wire edges and keep the node", () => {
            const offPlane = lineCurve(new XYZ({ x: 3, y: 1, z: 7 }), XYZ.unitY, 1, 2); // parallel plane at z=7
            const { cmd, parent } = buildWireCommand({ curves: [X_CURVE(), offPlane] });

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

        test("should extend non-adjacent edges of the same wire", () => {
            const { cmd, wire, sel0, sel1, created } = buildWireCommand();
            // a 4-edge wire where the picked edges sit at index 0 and 2; the diagonal
            // shares X's first end and Y's last end, the fourth edge is far away
            const wider = [
                wireMember(XYZ.zero, new XYZ({ x: 1, y: 0, z: 0 }), sel0),
                wireMember(XYZ.zero, new XYZ({ x: 3, y: 2, z: 0 })),
                wireMember(new XYZ({ x: 3, y: 1, z: 0 }), new XYZ({ x: 3, y: 2, z: 0 }), sel1),
                wireMember(new XYZ({ x: 10, y: 10, z: 0 }), new XYZ({ x: 11, y: 11, z: 0 })),
            ];
            (wire as any).findSubShapes = () => wider;

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(calls["wire"]).toHaveLength(1);
                expect(calls["wire"][0][0]).toEqual([created[0], wider[1], created[1], wider[3]]);
            } finally {
                restore();
            }
        });

        test("should only extend the target edge of a wire when modifyBoundary is false", () => {
            const { cmd, parent, trims, created, allEdges } = buildWireCommand();
            (cmd as any).modifyBoundary = false;

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(trims[0]).toEqual([[0, 3]]); // target edge extended to x=3
                expect(trims[1]).toEqual([]); // the boundary edge is left unchanged
                expect(calls["wire"]).toHaveLength(1);
                expect(calls["wire"][0][0]).toEqual([allEdges[0], created[0], allEdges[2]]);
                expect(parent.added).toHaveLength(1);
                expect(parent.removed).toHaveLength(1);
            } finally {
                restore();
            }
        });

        test("should extend a wire edge to a standalone boundary edge", () => {
            const cmd = new ExtendCommand();
            const { doc } = wireCommand(cmd);
            const parent = doc.modelManager.rootNode as unknown as TrackingParent;
            const wire = typedParent(ShapeTypes.wire);
            const body = typedParent(ShapeTypes.edge);

            const trims: [unknown[][], unknown[][]] = [[], []];
            const created: MockShape[] = [];
            seedStepDatas(cmd, [
                shapeStepResult([
                    {
                        shape: curveEdgeData(wire, X_CURVE(), trims[0], created),
                        node: edgeNode("wire0", parent, wire, doc),
                    },
                ]),
                shapeStepResult([
                    {
                        shape: curveEdgeData(body, Y_CURVE(), trims[1], created),
                        node: edgeNode("edge1", parent, body, doc),
                    },
                ]),
            ]);

            const sel0 = (cmd as any).stepDatas[0].shapes[0].shape;
            // the first edge shares X's first end (0,0), so X's last end is free
            const allEdges = [
                wireMember(XYZ.zero, new XYZ({ x: 5, y: 5, z: 0 })),
                wireMember(XYZ.zero, new XYZ({ x: 1, y: 0, z: 0 }), sel0),
                wireMember(new XYZ({ x: 9, y: 9, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
            ];
            (wire as any).findSubShapes = () => allEdges;

            const { calls, restore } = captureFactory();
            try {
                (cmd as any).executeMainTask();

                expect(trims[0]).toEqual([[0, 3]]); // the wire edge is extended to x=3
                expect(trims[1]).toEqual([[0, 2]]); // the standalone boundary is extended to y=0
                expect(calls["wire"]).toHaveLength(1);
                expect(calls["wire"][0][0]).toEqual([allEdges[0], created[0], allEdges[2]]);
                // the rebuilt wire node and the replaced boundary node
                expect(parent.added).toHaveLength(2);
                expect(parent.removed).toHaveLength(2);
            } finally {
                restore();
            }
        });

        test("should extend two standalone edges and replace their nodes", () => {
            const { cmd, parent, trims, created } = buildStandaloneCommand();

            (cmd as any).executeMainTask();

            expect(trims[0]).toEqual([[0, 3]]);
            expect(trims[1]).toEqual([[0, 2]]);
            expect(parent.added).toHaveLength(2);
            expect(parent.removed).toHaveLength(2);

            const [added1, added2] = parent.added as any[];
            expect(added1.name).toBe("edge0");
            expect(added1.shape.value).toBe(created[0]);
            expect(added2.name).toBe("edge1");
            expect(added2.shape.value).toBe(created[1]);
        });

        test("should only extend the target edge when modifyBoundary is false", () => {
            // the vertical boundary already passes through the corner (3,0)
            const boundary = lineCurve(new XYZ({ x: 3, y: -1, z: 0 }), XYZ.unitY, -1, 2);
            const { cmd, parent, trims, created } = buildStandaloneCommand({
                shapes: [
                    (ctx) => curveEdgeData(ctx.body, X_CURVE(), ctx.trims, ctx.created),
                    (ctx) => curveEdgeData(ctx.body, boundary, ctx.trims, ctx.created),
                ],
            });
            (cmd as any).modifyBoundary = false;

            (cmd as any).executeMainTask();

            expect(trims[0]).toEqual([[0, 3]]); // X segment [0,1] extended to x=3
            expect(trims[1]).toEqual([]); // the boundary edge is left unchanged
            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);
            const added = parent.added[0] as any;
            expect(added.name).toBe("edge0");
            expect(added.shape.value).toBe(created[0]);
        });

        test("should extend the target to the implied corner when modifyBoundary is false", () => {
            // the corner (3,0) misses the Y segment [1,2]; the boundary is met at
            // its implied extension and stays unchanged
            const { cmd, parent, trims, created } = buildStandaloneCommand();
            (cmd as any).modifyBoundary = false;

            (cmd as any).executeMainTask();

            expect(trims[0]).toEqual([[0, 3]]); // X segment [0,1] extended to x=3
            expect(trims[1]).toEqual([]); // the boundary edge is left unchanged
            expect(parent.added).toHaveLength(1);
            expect(parent.removed).toHaveLength(1);
            const added = parent.added[0] as any;
            expect(added.name).toBe("edge0");
            expect(added.shape.value).toBe(created[0]);
        });

        test("should report an error for non-straight edges and keep the nodes", () => {
            const { cmd, parent } = buildStandaloneCommand();
            // strip the line direction so the basis curve is no longer a line
            (cmd as any).stepDatas[0].shapes[0].shape.curve.basisCurve = {};

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

        test("should report an error when the corner lands on the anchored end of a wire edge", () => {
            // the vertical boundary crosses X exactly at X's shared first end (0,0):
            // the free end cannot move there without the edge shrinking to a point
            const yAtOrigin = lineCurve(new XYZ({ x: 0, y: -1, z: 0 }), XYZ.unitY, -1, 2);
            const { cmd, parent, trims } = buildWireCommand({
                curves: [X_CURVE(), yAtOrigin],
                specs: [{ trimUndefined: true }, {}],
            });

            const pubsub = capturePubSub();
            try {
                (cmd as any).executeMainTask();

                expect(trims[0]).toEqual([[0, 0]]); // the empty window was attempted
                expect(
                    pubsub.pubs.some(
                        (args) => args[0] === "displayError" && String(args[1]).includes("shrink to a point"),
                    ),
                ).toBe(true);
                expect(parent.added).toHaveLength(0);
                expect(parent.removed).toHaveLength(0);
            } finally {
                pubsub.restore();
            }
        });

        test("should report an error when a maximal extent cannot be built", () => {
            const center = new XYZ({ x: 2, y: 4, z: 0 });
            const { cmd, parent } = buildStandaloneCommand({
                shapes: [
                    (ctx) =>
                        curveEdgeData(ctx.body, X_CURVE(), ctx.trims, ctx.created, { trimUndefined: true }),
                    (ctx) =>
                        curveEdgeData(ctx.body, arcCurve(center, 5, -1.2, 0), ctx.trims, ctx.created, {
                            curveParameter: circleParameter(center, -1.2),
                        }),
                ],
            });

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
    });

    describe("arcs", () => {
        test("should extend a line and an arc to their nearest intersection", () => {
            const center = new XYZ({ x: 2, y: 4, z: 0 });
            // the full circle meets the X axis at x=-1 and x=5; the arc already passes
            // through (5,0), so it is the geometrically nearest intersection even though
            // (-1,0) is closer to the arc in parameter (angle) space
            const intersections = [
                { point: new XYZ({ x: -1, y: 0, z: 0 }), parameter: -1 },
                { point: new XYZ({ x: 5, y: 0, z: 0 }), parameter: 5 },
            ];
            const { cmd, parent, trims, created } = buildStandaloneCommand({
                shapes: [
                    (ctx) => curveEdgeData(ctx.body, X_CURVE(), ctx.trims, ctx.created, { intersections }),
                    (ctx) =>
                        curveEdgeData(ctx.body, arcCurve(center, 5, -1.2, 0), ctx.trims, ctx.created, {
                            curveParameter: circleParameter(center, -1.2),
                        }),
                ],
            });

            (cmd as any).executeMainTask();

            expect(trims[0].at(-1)).toEqual([0, 5]); // the last trim is the extended edge
            expect(trims[1].at(-1)![0]).toBeCloseTo(Math.atan2(-4, 3)); // keeps the longer side
            expect(trims[1].at(-1)![1]).toBe(0);
            expect(parent.added).toHaveLength(2);
            expect(parent.removed).toHaveLength(2);
            const [added1, added2] = parent.added as any[];
            expect(added1.shape.value).toBe(created.at(-2));
            expect(added2.shape.value).toBe(created.at(-1));
        });

        test("should extend two arcs to their nearest intersection", () => {
            const h = Math.sqrt(1.75); // y of the intersections of the two full circles
            const a = Math.atan2(h, 1.5); // the intersection's angle on circle A
            const centerB = new XYZ({ x: 3, y: 0, z: 0 });
            const u = Math.PI / 2;
            // the full circles meet at (1.5, ±h); the upper point needs less extension
            const intersections = [
                { point: new XYZ({ x: 1.5, y: h, z: 0 }), parameter: a },
                { point: new XYZ({ x: 1.5, y: -h, z: 0 }), parameter: 2 * Math.PI - a },
            ];
            const { cmd, trims } = buildStandaloneCommand({
                shapes: [
                    (ctx) =>
                        curveEdgeData(ctx.body, arcCurve(XYZ.zero, 2, u, Math.PI), ctx.trims, ctx.created, {
                            intersections,
                        }),
                    (ctx) =>
                        curveEdgeData(ctx.body, arcCurve(centerB, 2, u, Math.PI), ctx.trims, ctx.created, {
                            curveParameter: circleParameter(centerB, u),
                        }),
                ],
            });

            (cmd as any).executeMainTask();

            // A extended back to the intersection angle, B keeps its longer side up to it
            expect(trims[0].at(-1)![0]).toBeCloseTo(a);
            expect(trims[0].at(-1)![1]).toBeCloseTo(Math.PI);
            expect(trims[1].at(-1)![0]).toBeCloseTo(u);
            expect(trims[1].at(-1)![1]).toBeCloseTo(Math.PI - a);
        });

        test("should prefer the intersection reached from the picked endpoint", () => {
            const center = new XYZ({ x: 2, y: 4, z: 0 });
            // the full circle meets the X axis at x=-1 and x=5; (5,0) is geometrically
            // nearer, but the line was picked near x=0 - the end that reaches (-1,0)
            const intersections = [
                { point: new XYZ({ x: -1, y: 0, z: 0 }), parameter: -1 },
                { point: new XYZ({ x: 5, y: 0, z: 0 }), parameter: 5 },
            ];
            const { cmd, trims } = buildStandaloneCommand({
                shapes: [
                    (ctx) => curveEdgeData(ctx.body, X_CURVE(), ctx.trims, ctx.created, { intersections }),
                    (ctx) =>
                        curveEdgeData(ctx.body, arcCurve(center, 5, -1.2, 0), ctx.trims, ctx.created, {
                            curveParameter: circleParameter(center, -1.2),
                        }),
                ],
            });
            (cmd as any).stepDatas[0].shapes[0].point = new XYZ({ x: 0, y: 0, z: 0 }); // picked near x=0

            (cmd as any).executeMainTask();

            expect(trims[0].at(-1)).toEqual([-1, 1]); // extended towards (-1,0), not the nearer (5,0)
            expect(trims[1].at(-1)![0]).toBeCloseTo(Math.atan2(-4, -3));
            expect(trims[1].at(-1)![1]).toBe(0);
        });

        test("should report an error when the line and the arc never meet", () => {
            const center = new XYZ({ x: 3, y: 5, z: 0 }); // the circle stays clear of the X axis
            const { cmd, parent } = buildStandaloneCommand({
                shapes: [
                    (ctx) =>
                        curveEdgeData(ctx.body, X_CURVE(), ctx.trims, ctx.created, { intersections: [] }),
                    (ctx) =>
                        curveEdgeData(ctx.body, arcCurve(center, 1, 0, 1), ctx.trims, ctx.created, {
                            curveParameter: circleParameter(center, 0),
                        }),
                ],
            });

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

        test("should report an error when the arc would become a full circle", () => {
            const u1 = 0.0005; // an almost full circle with a tiny gap around angle 0
            const tangentLine = lineCurve(new XYZ({ x: 1, y: -1, z: 0 }), XYZ.unitY, -1, 0.5);
            const intersections = [{ point: new XYZ({ x: 1, y: 0, z: 0 }), parameter: 0 }];
            const { cmd, parent } = buildStandaloneCommand({
                shapes: [
                    (ctx) => curveEdgeData(ctx.body, tangentLine, ctx.trims, ctx.created, { intersections }),
                    (ctx) =>
                        curveEdgeData(
                            ctx.body,
                            arcCurve(XYZ.zero, 1, u1, 2 * Math.PI - u1),
                            ctx.trims,
                            ctx.created,
                            { curveParameter: circleParameter(XYZ.zero, u1) },
                        ),
                ],
            });

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
    });
});
