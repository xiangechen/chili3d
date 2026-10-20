// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    Matrix4,
    Plane,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    Signal,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type SketchData, SketchNode } from "../src/sketch";
import "../src/features"; // registers all feature handlers
import {
    type CurvePatternFeatureData,
    featureHandler,
    type PatternFeatureData,
    type PatternLineSource,
} from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", { value: methods, writable: true, configurable: true });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 1, 0] },
        { id: 2, type: "line", params: [1, 0, 1, 1] },
        { id: 3, type: "line", params: [1, 1, 0, 1] },
        { id: 4, type: "line", params: [0, 1, 0, 0] },
    ],
    constraints: [],
};

function edge(start: XYZ, end: XYZ) {
    const direction = end.sub(start);
    const length = direction.length();
    const self: any = {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
            // The path sampler's side of a curve: uniform arc-length points and the
            // parameter each of them sits at (a line's parameter IS its length fraction).
            uniformAbscissaByCount: (count: number) =>
                Array.from({ length: count + 1 }, (_, index) => start.add(direction.multiply(index / count))),
            parameter: (point: XYZ) =>
                length === 0 ? undefined : point.sub(start).dot(direction) / (length * length),
            value: (parameter: number) => start.add(direction.multiply(parameter)),
            d1: (parameter: number) => ({
                point: start.add(direction.multiply(parameter)),
                vec: direction,
            }),
            period: () => 0,
            isPeriodic: () => false,
        },
        length: () => length,
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: () => [],
        boundingBox: () =>
            new BoundingBox(
                { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) },
                { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) },
            ),
        isEqual: () => false,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [self] : []),
    };
    return self;
}

/** The line edge the direction refs point at: the +X unit segment at the origin. */
const DIRECTION_EDGE = () => edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));

/** The direction ref matching DIRECTION_EDGE's fingerprint (source-local coordinates). */
const DIRECTION_REF = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } } as const;

function setupMocks() {
    /** Pattern copies are made with `transformedMul`; the copy remembers the matrix. */
    const withTransform = <T extends object>(shape: T): T & { transformedMul: (m: Matrix4) => any } =>
        Object.assign(shape, {
            transformedMul: rs.fn((matrix: Matrix4) =>
                withTransform({
                    shapeType: (shape as any).shapeType,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: (shape as any).findSubShapes ?? (() => []),
                    transformedBy: matrix,
                } as any),
            ),
        });
    const prismShape = withTransform({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    });
    const fusedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
    const wire = rs.fn((edges: any[]) =>
        Result.ok({
            isClosed: () => edges.length > 1,
            edges,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const face = rs.fn((wires: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        }),
    );
    const prism = rs.fn((_profileFace: any, _vec: XYZ) => Result.ok(prismShape));
    const booleanFuse = rs.fn((_s1: any[], _s2: any[], _simplify: boolean) => Result.ok(fusedShape));
    // SketchNode.generateShape also combines (its entity edges), so each call gets its own
    // compound and the pattern assertions look up the one whose inputs start with the input.
    const compounds: any[] = [];
    const combine = rs.fn((shapes: any[]) => {
        const compound = withTransform({
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => shapes.filter((s) => s.shapeType === type),
            combinedShapes: shapes,
        });
        compounds.push(compound);
        return Result.ok(compound);
    });
    const restore = mockShapeFactory({ line, wire, face, prism, booleanFuse, combine });
    return { line, wire, face, prism, booleanFuse, combine, compounds, prismShape, fusedShape, restore };
}

describe("pattern feature", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupMocks();
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);
    });

    afterEach(() => mocks.restore());

    function bodyWith(features: any[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    /** A body whose extrude is patterned; the direction ref lives on `sourceId`. */
    function patternedBody(
        feature: Partial<PatternFeatureData> & { mode: "linear" | "circular" },
        sourceId?: string,
    ) {
        const source = sourceId ?? "source";
        const pattern =
            feature.mode === "linear"
                ? {
                      direction: { nodeId: source, edge: DIRECTION_REF },
                      spacing: 10,
                      ...feature,
                  }
                : {
                      axis: { nodeId: source, edge: DIRECTION_REF },
                      ...feature,
                  };
        return bodyWith([
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "p1", count: 3, ...pattern, type: "pattern" },
        ]);
    }

    /** A foreign source node exposing the +X direction edge on its shape. */
    function sourceBody() {
        const body = bodyWith([{ id: "e0", type: "extrude", sketchId: sketch.id, depth: 2 }]);
        const directionEdge = DIRECTION_EDGE();
        body.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.edge ? [directionEdge] : []) as any;
        return body;
    }

    /** Line references matching `pathEdges`' own fingerprints (source-local coordinates). */
    const lineRefsOf = (pathEdges: any[]) =>
        pathEdges.map((pathEdge) => ({
            kind: "line" as const,
            start: {
                x: pathEdge.startPoint().x,
                y: pathEdge.startPoint().y,
                z: pathEdge.startPoint().z,
            },
            end: { x: pathEdge.endPoint().x, y: pathEdge.endPoint().y, z: pathEdge.endPoint().z },
        }));

    /**
     * A body whose pattern runs along `pathEdges` on a foreign source node: the refs are the
     * edges' own lines, so the fingerprint matcher finds them on the source's shape.
     */
    function curvePatternBody(
        pathEdges: any[],
        feature: Partial<CurvePatternFeatureData> & { count: number },
    ) {
        const source = sourceBody();
        source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.edge ? pathEdges : []) as any;
        return bodyWith([
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
            {
                id: "p1",
                type: "pattern",
                mode: "curve",
                path: { nodeId: source.id, edges: lineRefsOf(pathEdges) },
                ...feature,
            },
        ]);
    }

    /** The two-segment L the curve tests run along: 10mm +X, then 20mm +Y. */
    const lPath = () => [
        edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
        edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 20, z: 0 })),
    ];

    /** The matrices the copies were built with, in build order. */
    const copyMatrices = () =>
        (mocks.booleanFuse.mock.calls.at(-1) as unknown as [any[], any[]])[1].map(
            (copy: any) => copy.transformedBy as Matrix4,
        );

    test("is registered with its per-mode ribbon identity", () => {
        const handler = featureHandler("pattern");
        expect(handler).toBeDefined();
        const linear = { id: "p", type: "pattern", mode: "linear" } as PatternFeatureData;
        const circular = { id: "p", type: "pattern", mode: "circular" } as PatternFeatureData;
        const curve = { id: "p", type: "pattern", mode: "curve" } as PatternFeatureData;
        expect((handler!.display as (f: PatternFeatureData) => string)(linear)).toBe(
            "command.feature.patternLinear",
        );
        expect((handler!.display as (f: PatternFeatureData) => string)(circular)).toBe(
            "command.feature.patternCircular",
        );
        expect((handler!.display as (f: PatternFeatureData) => string)(curve)).toBe(
            "command.feature.patternCurve",
        );
        expect((handler!.icon as (f: PatternFeatureData) => string)(linear)).toBe("icon-array");
        expect((handler!.icon as (f: PatternFeatureData) => string)(circular)).toBe("icon-rotate");
        expect((handler!.icon as (f: PatternFeatureData) => string)(curve)).toBe("icon-curveProject");
        expect(handler!.reselectable).toBe(true);
    });

    test("linear: fuses count−1 translated copies, original first, tools in order", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "linear", count: 3 }, source.id);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.fusedShape);
        const [bases, tools, simplify] = mocks.booleanFuse.mock.calls[0] as unknown as [
            any[],
            any[],
            boolean,
        ];
        expect(bases).toEqual([mocks.prismShape]);
        expect(tools).toHaveLength(2);
        expect(simplify).toBe(true);
        // The direction edge runs +X: copies at 10mm and 20mm.
        expect(tools[0].transformedBy.ofPoint(XYZ.zero).x).toBeCloseTo(10);
        expect(tools[1].transformedBy.ofPoint(XYZ.zero).x).toBeCloseTo(20);
        // The copies are intermediates of the fuse — disposed once it returns.
        expect(tools[0].dispose).toHaveBeenCalledTimes(1);
        expect(tools[1].dispose).toHaveBeenCalledTimes(1);
    });

    test("linear with a second direction builds the grid, direction 1 first", () => {
        const source = sourceBody();
        const upEdge = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 0, y: 10, z: 0 }));
        const upRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 10, z: 0 } } as const;
        source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.edge ? [DIRECTION_EDGE(), upEdge] : []) as any;
        const body = patternedBody(
            {
                mode: "linear",
                count: 2,
                direction2: { nodeId: source.id, edge: upRef },
                count2: 2,
                spacing2: 30,
            },
            source.id,
        );

        expect(body.shape.isOk).toBe(true);
        const matrices = copyMatrices();
        expect(matrices).toHaveLength(3);
        // Flattening runs direction 1 first: (10,0), then the second row (0,30), (10,30).
        const offsets = matrices.map((m) => m.ofPoint(XYZ.zero));
        expect([offsets[0].x, offsets[0].y]).toEqual([10, 0]);
        expect([offsets[1].x, offsets[1].y]).toEqual([0, 30]);
        expect([offsets[2].x, offsets[2].y]).toEqual([10, 30]);
    });

    test("circular: equal spacing spreads a full turn so the last copy misses the original", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "circular", count: 4 }, source.id);

        expect(body.shape.isOk).toBe(true);
        const matrices = copyMatrices();
        expect(matrices).toHaveLength(3);
        // 360°/4 about the +X "axis" edge's direction — the axis is X here, so a point off the
        // axis on +Y lands on +Z, −Y, −Z at 90° steps (right-hand rule).
        const probe = new XYZ({ x: 0, y: 10, z: 0 });
        const round0 = (v: number) => Math.round(v) || 0; // `|| 0` folds -0 into +0
        const [a, b, c] = matrices.map((m) => m.ofPoint(probe));
        expect([a.x, a.y, a.z].map(round0)).toEqual([0, 0, 10]);
        expect([b.x, b.y, b.z].map(round0)).toEqual([0, -10, 0]);
        expect([c.x, c.y, c.z].map(round0)).toEqual([0, 0, -10]);
    });

    test("circular without equal spacing treats the angle as the first-to-last span", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "circular", count: 3, angle: 90, equalSpacing: false }, source.id);

        expect(body.shape.isOk).toBe(true);
        // Span 90° over 3 instances: copies at 45° and 90° (equal spacing would use 30°/60°).
        const probe = new XYZ({ x: 0, y: 10, z: 0 });
        const [a, b] = copyMatrices().map((m) => m.ofPoint(probe));
        expect([a.y, a.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
            Math.round(10 * Math.SQRT1_2 * 1e6) / 1e6,
            Math.round(10 * Math.SQRT1_2 * 1e6) / 1e6,
        ]);
        expect([Math.round(b.y), Math.round(b.z)]).toEqual([0, 10]);
    });

    test("skip drops copies by their flattened index without renaming the survivors", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "linear", count: 4, skip: [1] }, source.id);

        expect(body.shape.isOk).toBe(true);
        const matrices = copyMatrices();
        // Copy 1 (x+20) is gone; copies 0 (x+10) and 2 (x+30) keep their own offsets.
        expect(matrices).toHaveLength(2);
        expect(matrices.map((m) => Math.round(m.ofPoint(XYZ.zero).x))).toEqual([10, 30]);
    });

    test("skipping every copy passes the input through", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "linear", count: 2, skip: [0] }, source.id);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.booleanFuse).not.toHaveBeenCalled();
    });

    test("merge: false combines input and copies in one compound", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "linear", count: 3, merge: false }, source.id);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.booleanFuse).not.toHaveBeenCalled();
        const compound = mocks.compounds.find((c) => c.combinedShapes.includes(mocks.prismShape));
        expect(compound).toBeDefined();
        expect(body.shape.unchecked()).toBe(compound);
        const shapes = compound.combinedShapes as any[];
        expect(shapes).toHaveLength(3);
        expect(shapes[0]).toBe(mocks.prismShape);
        // The compound owns its copies — not disposed (the mirror's combine contract).
        expect(shapes[1].dispose).not.toHaveBeenCalled();
        expect(shapes[2].dispose).not.toHaveBeenCalled();
    });

    test("a moved host patterns along the direction mapped into its own frame", () => {
        const source = sourceBody();
        // The source is rotated 90° about Z: its local +X edge runs along world +Y.
        source.transform = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        const body = patternedBody({ mode: "linear", count: 2 }, source.id);

        expect(body.shape.isOk).toBe(true);
        const matrices = copyMatrices();
        expect(Math.round(matrices[0].ofPoint(XYZ.zero).y)).toBe(10);
        expect(Math.round(matrices[0].ofPoint(XYZ.zero).x)).toBe(0);
    });

    test("a lost direction builds from the frozen fingerprint and reports the pick unresolved", () => {
        // No source node with this id — the frozen ref's own +X line stands in.
        const body = patternedBody({ mode: "linear", count: 2 }, "deleted");

        expect(body.shape.isOk).toBe(true);
        const matrices = copyMatrices();
        expect(Math.round(matrices[0].ofPoint(XYZ.zero).x)).toBe(10);
        expect(body.featureItems()[1].missingInputs).toEqual([
            { key: "direction", refIndex: 0, label: expect.any(String) },
        ]);
    });

    test("fails without a preceding feature", () => {
        const body = bodyWith([
            {
                id: "p1",
                type: "pattern",
                mode: "linear",
                direction: { nodeId: "any", edge: DIRECTION_REF },
                count: 3,
                spacing: 10,
            },
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Pattern requires a preceding feature");
    });

    test.each([
        [{ count: 1 }, "Pattern count must be at least 2"],
        [{ count: 2.5 }, "Pattern count must be a whole number"],
        [{ count: "nope +" }, "Unknown identifier: nope"],
        [{ spacing: 0 }, "Pattern spacing must be non-zero"],
    ])("linear rejects %o with '%s'", (patch, message) => {
        const source = sourceBody();
        const body = patternedBody({ mode: "linear", ...patch }, source.id);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe(message);
    });

    test("circular rejects a zero angle", () => {
        const source = sourceBody();
        const body = patternedBody({ mode: "circular", count: 3, angle: 0 }, source.id);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Pattern angle must be non-zero");
    });

    test("curve: a locked pattern translates the copies along the path", () => {
        const body = curvePatternBody(lPath(), {
            count: 3,
            equalSpacing: true,
            orientation: "locked",
        });

        expect(body.shape.isOk).toBe(true);
        // The L is 10 + 20 long; three equal-spaced instances sit at 15 and 30.
        const [first, second] = copyMatrices().map((m) => m.ofPoint(XYZ.zero));
        expect([first.x, first.y]).toEqual([10, 5]);
        expect([second.x, second.y]).toEqual([10, 20]);
    });

    test("curve: a tangent pattern turns the copies with the path", () => {
        const body = curvePatternBody(lPath(), { count: 3, equalSpacing: true });

        expect(body.shape.isOk).toBe(true);
        // The second segment runs +Y: a copy there is the seed turned 90° about the path start.
        const probe = new XYZ({ x: 1, y: 0, z: 0 });
        const [first, second] = copyMatrices().map((m) => m.ofPoint(probe));
        expect([first.x, first.y].map(Math.round)).toEqual([10, 6]);
        expect([second.x, second.y].map(Math.round)).toEqual([10, 21]);
    });

    test("curve: fixed distance steps by the spacing instead of filling the path", () => {
        const body = curvePatternBody(lPath(), {
            count: 3,
            equalSpacing: false,
            spacing: 5,
            orientation: "locked",
        });

        expect(body.shape.isOk).toBe(true);
        const offsets = copyMatrices().map((m) => m.ofPoint(XYZ.zero));
        expect(offsets.map((p) => [p.x, p.y])).toEqual([
            [5, 0],
            [10, 0],
        ]);
    });

    test("curve: a closed path divides by the count so the last copy misses the original", () => {
        const corners = [
            new XYZ({ x: 0, y: 0, z: 0 }),
            new XYZ({ x: 10, y: 0, z: 0 }),
            new XYZ({ x: 10, y: 10, z: 0 }),
            new XYZ({ x: 0, y: 10, z: 0 }),
        ];
        const loop = corners.map((corner, index) => edge(corner, corners[(index + 1) % corners.length]));
        // An OPEN path of the same edges uses L/(count−1) = 13.33 for its first step; the
        // closed one uses L/count = 10, which is what the first copy's seat tells apart.
        const open = loop.slice(0, 3);
        const closedBody = curvePatternBody(loop, { count: 3, orientation: "locked" });
        expect(closedBody.shape.isOk).toBe(true);
        const closedOffset = copyMatrices()[0].ofPoint(XYZ.zero);
        expect([closedOffset.x, closedOffset.y].map(Math.round)).toEqual([10, 3]);

        const openBody = curvePatternBody(open, { count: 3, orientation: "locked" });
        expect(openBody.shape.isOk).toBe(true);
        const openOffset = copyMatrices()[0].ofPoint(XYZ.zero);
        // The open path is 30 long: its first copy sits at 15, halfway up the second segment.
        expect([openOffset.x, openOffset.y].map(Math.round)).toEqual([10, 5]);
    });

    test.each([
        [
            { count: 3, equalSpacing: false, spacing: 20 },
            "Pattern path is too short for the count and spacing",
        ],
        [{ count: 3, equalSpacing: false, spacing: 0 }, "Pattern spacing must be non-zero"],
    ])("curve rejects %o with '%s'", (patch, message) => {
        const body = curvePatternBody(lPath(), patch as Partial<CurvePatternFeatureData> & { count: number });

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe(message);
    });

    test("curve refuses edges that do not form one connected chain", () => {
        const detached = [
            edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
            edge(new XYZ({ x: 30, y: 0, z: 0 }), new XYZ({ x: 40, y: 0, z: 0 })),
        ];

        const body = curvePatternBody(detached, { count: 2 });

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Pattern path edges must connect end to end");
    });

    test("curve reports a missing path body instead of arraying along a guess", () => {
        const source = sourceBody();
        const body = bodyWith([
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
            {
                id: "p1",
                type: "pattern",
                mode: "curve",
                path: { nodeId: "deleted", edges: [] },
                count: 2,
            },
        ]);
        expect(source.shape.isOk).toBe(true);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Pattern path body not found");
    });

    test("a rotated host maps a moved foreign path into its own frame", () => {
        const source = sourceBody();
        const pathEdges = [edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 }))];
        source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.edge ? pathEdges : []) as any;
        source.transform = Matrix4.fromTranslation(10, 0, 0);
        const body = bodyWith([
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
            {
                id: "p1",
                type: "pattern",
                mode: "curve",
                count: 2,
                orientation: "locked",
                path: {
                    nodeId: source.id,
                    edges: [{ kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 20, y: 0, z: 0 } }],
                },
            },
        ]);
        // A rotation and a translation only disagree about composition order — the host must be
        // turned, not merely moved, for this to pin the source → world → host mapping down.
        body.transform = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        body.setFeaturesEmitShapeChanged([...body.features]);

        expect(body.shape.isOk).toBe(true);
        const offset = copyMatrices()[0].ofPoint(XYZ.zero);
        // World path: (10,0)→(30,0). Host = rotated −90°: (0,−10)→(0,−30), so the copy moves 20
        // along the host's −Y.
        expect([Math.round(offset.x), Math.round(offset.y)]).toEqual([0, -20]);
    });

    test("a path on the host's own input is matched against that input", () => {
        const pathEdges = lPath();
        // The most common pick: edges of the body being patterned. They belong to an earlier
        // feature, so they are re-matched on this feature's INPUT, not on the final shape.
        mocks.prismShape.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.edge ? pathEdges : []) as any;
        const body = new ParametricBodyNode({
            document: doc,
            id: "host1",
            features: [
                { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
                {
                    id: "p1",
                    type: "pattern",
                    mode: "curve",
                    count: 3,
                    orientation: "locked",
                    path: { nodeId: "host1", edges: lineRefsOf(pathEdges) },
                },
            ],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(true);
        const [first] = copyMatrices().map((m) => m.ofPoint(XYZ.zero));
        // The L is 30 long: three equal instances sit at 15, on the second segment.
        expect([Math.round(first.x), Math.round(first.y)]).toEqual([10, 5]);
    });

    test("the panel rows follow the mode, and the direction-2 rows follow the data", () => {
        const handler = featureHandler("pattern")!;
        const linear: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "linear",
            direction: { nodeId: "n", edge: DIRECTION_REF },
            count: 3,
            spacing: 10,
        };
        expect(handler.parameters(linear).map((x) => x.key)).toEqual(["count", "spacing", "merge", "skip"]);
        const grid: PatternFeatureData = {
            ...linear,
            direction2: { nodeId: "n", edge: DIRECTION_REF },
        };
        expect(handler.parameters(grid).map((x) => x.key)).toEqual([
            "count",
            "spacing",
            "count2",
            "spacing2",
            "merge",
            "skip",
        ]);
        const circular: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "circular",
            axis: { nodeId: "n", edge: DIRECTION_REF },
            count: 4,
        };
        expect(handler.parameters(circular).map((x) => x.key)).toEqual([
            "count",
            "angle",
            "equalSpacing",
            "merge",
            "skip",
        ]);
        const curve: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "curve",
            path: { nodeId: "n", edges: [DIRECTION_REF] },
            count: 3,
        };
        // Equal spacing is the default, so the distance row is absent until it is switched off.
        expect(handler.parameters(curve).map((x) => x.key)).toEqual([
            "count",
            "equalSpacing",
            "orientation",
            "merge",
            "skip",
        ]);
        expect(handler.parameters({ ...curve, equalSpacing: false, spacing: 5 }).map((x) => x.key)).toEqual([
            "count",
            "spacing",
            "equalSpacing",
            "orientation",
            "merge",
            "skip",
        ]);
        const orientation = handler.parameters(curve).find((parameter) => parameter.key === "orientation");
        expect(orientation?.choices?.map((choice) => choice.value)).toEqual(["tangent", "locked"]);
    });

    test("setParameter writes values, booleans and the skip list", () => {
        const handler = featureHandler("pattern")!;
        const linear: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "linear",
            direction: { nodeId: "n", edge: DIRECTION_REF },
            count: 3,
            spacing: 10,
        };

        expect(handler.setParameter(linear, "count", "w * 2")).toMatchObject({ count: "w * 2" });
        expect(handler.setParameter(linear, "spacing", 25)).toMatchObject({ spacing: 25 });
        expect(handler.setParameter(linear, "merge", false)).toMatchObject({ merge: false });
        expect(handler.setParameter({ ...linear, merge: false }, "merge", "true")).toMatchObject({
            merge: true,
        });
        // Skip: comma-separated non-negative whole numbers, deduped; an empty field clears.
        expect(handler.setParameter(linear, "skip", "0, 3,3")).toMatchObject({ skip: [0, 3] });
        expect(handler.setParameter(linear, "skip", 2)).toMatchObject({ skip: [2] });
        expect(handler.setParameter({ ...linear, skip: [1] }, "skip", "")).toMatchObject({ skip: undefined });
        // A token that is not a non-negative integer rejects the whole edit.
        expect(handler.setParameter(linear, "skip", "1, x")).toBe(linear);
        expect(handler.setParameter(linear, "skip", "-1")).toBe(linear);
        // count2/spacing2 belong to the grid — without a second direction they do not stick.
        expect(handler.setParameter(linear, "count2", 4)).toBe(linear);
        const grid: PatternFeatureData = { ...linear, direction2: { nodeId: "n", edge: DIRECTION_REF } };
        expect(handler.setParameter(grid, "count2", 4)).toMatchObject({ count2: 4 });

        const curve: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "curve",
            path: { nodeId: "n", edges: [DIRECTION_REF] },
            count: 3,
        };
        expect(handler.setParameter(curve, "equalSpacing", false)).toMatchObject({ equalSpacing: false });
        expect(handler.setParameter(curve, "spacing", 8)).toMatchObject({ spacing: 8 });
        expect(handler.setParameter(curve, "orientation", "locked")).toMatchObject({
            orientation: "locked",
        });
        // A token outside the mode's set rejects the edit.
        expect(handler.setParameter(curve, "orientation", "sideways")).toBe(curve);
        // The line modes have no orientation to set.
        expect(handler.setParameter(linear, "orientation", "locked")).toBe(linear);
    });

    test("nodeIds and references follow the line sources", () => {
        const handler = featureHandler("pattern")!;
        const linear: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "linear",
            direction: { nodeId: "n1", edge: DIRECTION_REF },
            direction2: { nodeId: "n2", edge: DIRECTION_REF },
            count: 3,
            spacing: 10,
        };
        expect(handler.nodeIds(linear)).toEqual(["n1", "n2"]);
        expect(handler.references?.(linear)).toEqual([
            { key: "direction", display: "feature.pattern.direction", nodeId: "n1" },
            { key: "direction2", display: "feature.pattern.direction2", nodeId: "n2" },
        ]);
        const circular: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "circular",
            axis: { nodeId: "n3", edge: DIRECTION_REF },
            count: 4,
        };
        expect(handler.nodeIds(circular)).toEqual(["n3"]);
        expect(handler.references?.(circular)).toEqual([
            { key: "axis", display: "feature.pattern.axis", nodeId: "n3" },
        ]);
        const curve: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "curve",
            path: { nodeId: "n4", edges: [DIRECTION_REF] },
            count: 3,
        };
        expect(handler.nodeIds(curve)).toEqual(["n4"]);
        expect(handler.references?.(curve)).toEqual([
            { key: "path", display: "feature.pattern.path", nodeId: "n4" },
        ]);
    });

    test("applyResolvedRefs writes the anchors back into their own slots", () => {
        const handler = featureHandler("pattern")!;
        const fresh = { kind: "line", start: { x: 1, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } } as const;
        const linear: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "linear",
            direction: { nodeId: "n", edge: DIRECTION_REF },
            direction2: { nodeId: "n", edge: DIRECTION_REF },
            count: 3,
            spacing: 10,
        };
        const next = handler.applyResolvedRefs!(linear, { resolvedEdges: [fresh] }) as Extract<
            PatternFeatureData,
            { mode: "linear" }
        >;
        expect(next.direction.edge).toBe(fresh);
        // A hole in the anchors leaves the slot untouched.
        expect(next.direction2?.edge).toBe(DIRECTION_REF);
        const circular: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "circular",
            axis: { nodeId: "n", edge: DIRECTION_REF },
            count: 4,
        };
        const rotated = handler.applyResolvedRefs!(circular, { resolvedEdges: [fresh] }) as Extract<
            PatternFeatureData,
            { mode: "circular" }
        >;
        expect(rotated.axis.edge).toBe(fresh);

        const curve: PatternFeatureData = {
            id: "p1",
            type: "pattern",
            mode: "curve",
            path: { nodeId: "n", edges: [DIRECTION_REF, DIRECTION_REF] },
            count: 3,
        };
        const reanchored = handler.applyResolvedRefs!(curve, {
            resolvedEdges: [undefined, fresh],
        }) as Extract<PatternFeatureData, { mode: "curve" }>;
        expect(reanchored.path).toEqual({ nodeId: "n", edges: [fresh] });
    });

    describe("re-picking the line sources", () => {
        /**
         * The pick session's surroundings: a selection whose current shapes the pick resolves
         * with (the real picker's contract), and a picker that settles only when the user
         * clicks — a macrotask later, never synchronously. Each queued click is consumed by
         * one pick; with none left the pick hangs (the cancel tests settle it instead).
         */
        function mockPickSession(clicks: any[][]) {
            let current: any[] = [];
            const settleStates: boolean[] = [];
            doc.selection = {
                clearSelection: rs.fn(() => {
                    current = [];
                }),
                setSelectedShapes: rs.fn(),
                setSelectedNodes: rs.fn(),
                getSelectedShapes: () => current,
            } as any;
            doc.picker.pickShape = rs.fn((_prompt: unknown, controller: AsyncController) => {
                // A controller settled BEFORE its pick ran is a reused one — a settled
                // controller replays its result to late listeners, which is exactly the
                // bug this session guards against.
                settleStates.push(controller.result !== undefined);
                return new Promise<any[]>((resolve) => {
                    controller.onCompleted(() => resolve(current));
                    controller.onCancelled(() => resolve([]));
                    setTimeout(() => {
                        const click = clicks.shift();
                        if (click === undefined) return;
                        current = click;
                        controller.success();
                    }, 0);
                });
            }) as any;
            return { settleStates };
        }

        /** The session's host: a body whose linear pattern carries both directions. */
        function gridBody() {
            const source = sourceBody();
            const upEdge = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 0, y: 10, z: 0 }));
            const upRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 10, z: 0 } } as const;
            const longerX = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 }));
            const longerY = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 0, y: 20, z: 0 }));
            source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
                type === ShapeTypes.edge ? [DIRECTION_EDGE(), upEdge, longerX, longerY] : []) as any;
            const body = patternedBody(
                {
                    mode: "linear",
                    count: 2,
                    direction2: { nodeId: source.id, edge: upRef },
                    count2: 2,
                    spacing2: 30,
                },
                source.id,
            );
            expect(body.shape.isOk).toBe(true);
            const click = (shape: any, indexes: number[]) => [
                { owner: { node: source }, shape, transform: Matrix4.identity(), indexes },
            ];
            return { source, body, click1: click(longerX, [2]), click2: click(longerY, [3]) };
        }

        test("the two directions each wait for their own click, then write in one transaction", async () => {
            const { body, click1, click2 } = gridBody();
            const { settleStates } = mockPickSession([click1, click2]);
            const undoCount = doc.history.undoCount();

            await body.reselectSession("p1", new AsyncController());

            // Both picks ran on FRESH, unsettled controllers — reusing the caller's settled
            // one would replay its result instantly (and the first pick's teardown leaves the
            // host node selected, so the replayed pick would return nothing and write nothing).
            expect(settleStates).toEqual([false, false]);
            const pattern = body.features[1] as Extract<PatternFeatureData, { mode: "linear" }>;
            expect(pattern.direction.edge).toMatchObject({ end: { x: 20, y: 0, z: 0 } });
            expect(pattern.direction2?.edge).toMatchObject({ end: { x: 0, y: 20, z: 0 } });
            expect(body.featureItems()[1].error).toBeUndefined();
            expect(doc.history.undoCount()).toBe(undoCount + 1);
        });

        test("cancelling the first pick discards both — the second never runs", async () => {
            const { body, click1 } = gridBody();
            const { settleStates } = mockPickSession([click1]);
            const controller = new AsyncController();
            // The user cancels the SESSION (not the pick's own controller): the bridge into
            // the round is what ends the in-flight pick.
            setTimeout(() => controller.cancel(), 0);
            const undoCount = doc.history.undoCount();

            await body.reselectSession("p1", controller);

            expect(settleStates).toEqual([false]);
            const pattern = body.features[1] as Extract<PatternFeatureData, { mode: "linear" }>;
            expect(pattern.direction.edge).toEqual(DIRECTION_REF);
            expect(pattern.direction2?.edge).toEqual({
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 0, y: 10, z: 0 },
            });
            expect(doc.history.undoCount()).toBe(undoCount);
        });

        test("a curve pattern re-picks its whole path in one transaction", async () => {
            const source = sourceBody();
            const first = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const second = edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 }));
            source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
                type === ShapeTypes.edge ? [first, second] : []) as any;
            const body = bodyWith([
                { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
                {
                    id: "p1",
                    type: "pattern",
                    mode: "curve",
                    count: 2,
                    path: {
                        nodeId: source.id,
                        edges: [{ kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } }],
                    },
                },
            ]);
            expect(body.shape.isOk).toBe(true);
            const { settleStates } = mockPickSession([
                [
                    { owner: { node: source }, shape: first, transform: Matrix4.identity(), indexes: [0] },
                    { owner: { node: source }, shape: second, transform: Matrix4.identity(), indexes: [1] },
                ],
            ]);
            const undoCount = doc.history.undoCount();

            await body.reselectSession("p1", new AsyncController());

            expect(settleStates).toEqual([false]);
            const pattern = body.features[1] as Extract<PatternFeatureData, { mode: "curve" }>;
            expect(pattern.path.edges.map((ref) => ref.kind === "line" && ref.end)).toEqual([
                { x: 10, y: 0, z: 0 },
                { x: 20, y: 0, z: 0 },
            ]);
            expect(body.featureItems()[1].error).toBeUndefined();
            expect(doc.history.undoCount()).toBe(undoCount + 1);
        });

        test("a disconnected re-picked path is refused and the old one kept", async () => {
            const source = sourceBody();
            const first = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const second = edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 }));
            source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
                type === ShapeTypes.edge ? [first, second] : []) as any;
            const body = bodyWith([
                { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
                {
                    id: "p1",
                    type: "pattern",
                    mode: "curve",
                    count: 2,
                    path: {
                        nodeId: source.id,
                        edges: [
                            { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
                            { kind: "line", start: { x: 10, y: 0, z: 0 }, end: { x: 20, y: 0, z: 0 } },
                        ],
                    },
                },
            ]);
            expect(body.shape.isOk).toBe(true);
            // Two edges on the same node, but 20mm apart: the capture succeeds and the chain
            // does not — storing it would break the body on the next rebuild.
            const detached = edge(new XYZ({ x: 40, y: 0, z: 0 }), new XYZ({ x: 50, y: 0, z: 0 }));
            mockPickSession([
                [
                    { owner: { node: source }, shape: first, transform: Matrix4.identity(), indexes: [0] },
                    { owner: { node: source }, shape: detached, transform: Matrix4.identity(), indexes: [2] },
                ],
            ]);
            const undoCount = doc.history.undoCount();
            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await body.reselectSession("p1", new AsyncController());
                expect(
                    pub.mock.calls.some(
                        (call) =>
                            call[0] === "showToast" &&
                            call[2] === "Pattern path edges must connect end to end",
                    ),
                ).toBe(true);
            } finally {
                pub.mockRestore();
            }

            const pattern = body.features[1] as Extract<PatternFeatureData, { mode: "curve" }>;
            expect(pattern.path.edges).toHaveLength(2);
            expect(pattern.path.edges[1]).toMatchObject({ end: { x: 20, y: 0, z: 0 } });
            expect(body.featureItems()[1].error).toBeUndefined();
            expect(doc.history.undoCount()).toBe(undoCount);
        });
    });
});
