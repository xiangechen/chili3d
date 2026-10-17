// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type Plane, Result, type ShapeType, ShapeTypes, XYZ, type XYZLike } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/features"; // registers all feature handlers
import type { EdgeRef } from "../src/features/edgeRef";
import {
    type FeatureData,
    featureHandler,
    type PrimitiveFeatureData,
    type PrimitiveKind,
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

/** A face the seeding mock reports: planar with a fixed normal (or the lateral wall). */
function faceMock(normal: XYZLike, planar = true) {
    const self: any = {
        shapeType: ShapeTypes.face,
        surface: () => ({ isPlanar: () => planar }),
        normal: () => [XYZ.zero, new XYZ(normal)],
        isSame: (other: any) => other === self,
        findSubShapes: () => [],
        dispose: rs.fn(),
    };
    return self;
}

/** An edge the seeding mock reports: the two faces it borders. */
function edgeMock(faces: any[]) {
    return {
        shapeType: ShapeTypes.edge,
        findAncestor: (type: ShapeType) => (type === ShapeTypes.face ? faces : []),
        isEqual: () => false,
        dispose: rs.fn(),
    };
}

/** A box's six faces (order fixed so the id assertions below index them) and twelve edges. */
function boxSolid() {
    const faces = [
        faceMock({ x: 0, y: 0, z: -1 }),
        faceMock({ x: 0, y: 0, z: 1 }),
        faceMock({ x: -1, y: 0, z: 0 }),
        faceMock({ x: 1, y: 0, z: 0 }),
        faceMock({ x: 0, y: -1, z: 0 }),
        faceMock({ x: 0, y: 1, z: 0 }),
    ];
    const [bottom, top, west, east, south, north] = faces;
    const edges = [
        edgeMock([bottom, west]),
        edgeMock([bottom, east]),
        edgeMock([bottom, south]),
        edgeMock([bottom, north]),
        edgeMock([top, west]),
        edgeMock([top, east]),
        edgeMock([top, south]),
        edgeMock([top, north]),
        edgeMock([west, south]),
        edgeMock([west, north]),
        edgeMock([east, south]),
        edgeMock([east, north]),
    ];
    return {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: (type: ShapeType) =>
            type === ShapeTypes.face ? faces : type === ShapeTypes.edge ? edges : [],
    };
}

/** A cylinder: two caps, a lateral wall, two rim circles and the (unnamed) seam. */
function cylinderSolid() {
    const bottom = faceMock({ x: 0, y: 0, z: -1 });
    const top = faceMock({ x: 0, y: 0, z: 1 });
    const lateral = faceMock({ x: 1, y: 0, z: 0 }, false);
    const edges = [
        edgeMock([bottom, lateral]),
        edgeMock([top, lateral]),
        edgeMock([lateral, lateral]), // the seam: the same face on both sides
    ];
    return {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: (type: ShapeType) =>
            type === ShapeTypes.face ? [bottom, top, lateral] : type === ShapeTypes.edge ? edges : [],
    };
}

function setupMocks() {
    const bare = () => ({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    });
    const box = rs.fn((_plane: Plane, _dx: number, _dy: number, _dz: number) => Result.ok(boxSolid()));
    const cylinder = rs.fn((_normal: XYZLike, _center: XYZLike, _radius: number, _dz: number) =>
        Result.ok(cylinderSolid()),
    );
    const sphere = rs.fn((_center: XYZLike, _radius: number) => Result.ok(bare()));
    const cone = rs.fn((_normal: XYZLike, _center: XYZLike, _r1: number, _r2: number, _dz: number) =>
        Result.ok(bare()),
    );
    const fusedShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    };
    const booleanFuse = rs.fn((_s1: any[], _s2: any[], _simplify: boolean) => Result.ok(fusedShape));
    const restore = mockShapeFactory({ box, cylinder, sphere, cone, booleanFuse });
    return { box, cylinder, sphere, cone, booleanFuse, fusedShape, restore };
}

function primitive(extra: Partial<PrimitiveFeatureData> = {}): PrimitiveFeatureData {
    return { id: "f1", type: "primitive", primitive: "box", ...extra };
}

describe("primitive feature", () => {
    let doc: TestDocument;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupMocks();
    });

    afterEach(() => mocks.restore());

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    test("parameters: the type dropdown first, the origin, then every kind's rows gated by visibleWhen", () => {
        const rows = featureHandler("primitive")!.parameters(primitive());

        expect(rows.map((x) => x.key)).toEqual([
            "primitive",
            "origin.x",
            "origin.y",
            "origin.z",
            "dx",
            "dy",
            "dz",
            "radius",
            "radius",
            "radius",
            "radius2",
            "height",
            "height",
        ]);
        expect(rows[0].choices?.map((x) => x.value)).toEqual(["box", "cylinder", "sphere", "cone"]);
        // The origin's three coordinates share one panel row (see `FeatureParameter.group`),
        // labelled "Origin" with the coordinate letters demoted to the in-row labels.
        expect(rows.slice(1, 4).map((x) => x.display)).toEqual([
            "common.coordX",
            "common.coordY",
            "common.coordZ",
        ]);
        expect(rows.slice(1, 4).map((x) => x.group)).toEqual([
            { id: "origin", display: "common.origin" },
            { id: "origin", display: "common.origin" },
            { id: "origin", display: "common.origin" },
        ]);
        expect(rows[4].group).toBeUndefined();
        expect(rows[4].visibleWhen).toEqual([{ key: "primitive", value: "box" }]);
        expect(rows[10].visibleWhen).toEqual([{ key: "primitive", value: "cone" }]);
        expect(rows[11].visibleWhen).toEqual([{ key: "primitive", value: "cylinder" }]);
        // The kind's defaults stand in for fields the user never typed.
        expect(rows[4].value).toBe(10);
        expect(rows[7].value).toBe(5);
        expect(rows[10].value).toBe(2);
    });

    test("setParameter: the type takes a known kind and rejects an unknown one", () => {
        const handler = featureHandler("primitive")!;
        const feature = primitive();

        expect(handler.setParameter(feature, "primitive", "cone").primitive).toBe("cone");
        expect(handler.setParameter(feature, "primitive", "bogus")).toBe(feature);
    });

    test("setParameter: sizes are stored, keys outside the whitelist leave the feature untouched", () => {
        const handler = featureHandler("primitive")!;
        const feature = primitive();

        expect(handler.setParameter(feature, "dx", 30).dx).toBe(30);
        expect(handler.setParameter(feature, "radius2", "w / 2").radius2).toBe("w / 2");
        expect(handler.setParameter(feature, "operation", "cut")).toBe(feature);
        expect(handler.setParameter(feature, "bogus", 1)).toBe(feature);
    });

    test("setParameter: the origin rows write the dotted component, keeping the rest", () => {
        const handler = featureHandler("primitive")!;
        const feature = primitive({ origin: { x: 1, y: 2, z: 3 } });

        expect(handler.setParameter(feature, "origin.y", 9).origin).toEqual({ x: 1, y: 9, z: 3 });
        expect(handler.setParameter(feature, "origin.w", 9)).toBe(feature);
    });

    test("applyResolvedRefs writes the direction anchor back, only when there is a direction", () => {
        const handler = featureHandler("primitive")!;
        const direction = {
            nodeId: "a",
            edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1 } } as EdgeRef,
        };
        const feature = primitive({ direction });
        const anchor: EdgeRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } };

        expect(handler.applyResolvedRefs!(feature, {})).toBe(feature);
        expect(handler.applyResolvedRefs!(feature, { resolvedEdges: [anchor] }).direction?.edge).toBe(anchor);
        expect(
            handler.applyResolvedRefs!(primitive(), { resolvedEdges: [anchor] }).direction,
        ).toBeUndefined();
    });

    test("nodeIds and references name the direction's node — a sphere never has one", () => {
        const handler = featureHandler("primitive")!;
        const direction = {
            nodeId: "a",
            edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1 } } as EdgeRef,
        };

        expect(handler.nodeIds(primitive({ direction }))).toEqual(["a"]);
        expect(handler.references?.(primitive({ direction }))).toEqual([
            { key: "direction", display: "feature.primitive.direction", nodeId: "a" },
        ]);
        expect(handler.nodeIds(primitive({ primitive: "sphere", direction }))).toEqual([]);
        expect(handler.references?.(primitive({ primitive: "sphere", direction }))).toEqual([]);
    });

    test("the defaults build: box 10³, cylinder r5 h10, sphere r5, cone r5→2 h10", () => {
        const bodies = [
            bodyWith([primitive()]),
            bodyWith([primitive({ id: "f2", primitive: "cylinder" })]),
            bodyWith([primitive({ id: "f3", primitive: "sphere" })]),
            bodyWith([primitive({ id: "f4", primitive: "cone" })]),
        ];

        // The body builds lazily — touching the shape is what runs the feature.
        for (const body of bodies) expect(body.shape.isOk).toBe(true);
        expect(mocks.box.mock.calls[0].slice(1)).toEqual([10, 10, 10]);
        expect(mocks.cylinder.mock.calls[0].slice(2)).toEqual([5, 10]);
        expect(mocks.sphere.mock.calls[0][1]).toBe(5);
        expect(mocks.cone.mock.calls[0].slice(2)).toEqual([5, 2, 10]);
    });

    test("the origin lands on the construction plane, expressions resolved", () => {
        const body = bodyWith([primitive({ origin: { x: "2+3", y: 1, z: -1 } })]);

        expect(body.shape.isOk).toBe(true);
        const plane = mocks.box.mock.calls[0][0] as Plane;
        expect([plane.origin.x, plane.origin.y, plane.origin.z]).toEqual([5, 1, -1]);
    });

    test("a bad expression in a field the kind reads fails the rebuild with the resolver's message", () => {
        const body = bodyWith([primitive({ dx: "nosuchvar" })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Unknown identifier: nosuchvar");
    });

    test("a bad expression in a field the kind does not read costs nothing", () => {
        const body = bodyWith([primitive({ radius: "nosuchvar" })]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.box).toHaveBeenCalledTimes(1);
    });

    test("an unknown primitive kind is a rebuild error, not a crash", () => {
        // The persisted JSON is not validated against `PrimitiveKind`, so a kind no build of this
        // app wrote reaches the handler. The size table has no row for it, and every kind's rows
        // are absent from the feature — the rebuild must report that, not read through a missing row.
        const body = bodyWith([primitive({ primitive: "torus" as PrimitiveKind })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Unknown primitive kind: torus");
        expect(mocks.box).not.toHaveBeenCalled();
    });

    test.each([
        { extra: { dx: 0 }, error: "Box dimensions must be positive" },
        { extra: { primitive: "cylinder", radius: -1 }, error: "Cylinder radius must be positive" },
        { extra: { primitive: "cylinder", height: 0 }, error: "Cylinder height must be positive" },
        { extra: { primitive: "sphere", radius: 0 }, error: "Sphere radius must be positive" },
        { extra: { primitive: "cone", radius: 0 }, error: "Cone base radius must be positive" },
        { extra: { primitive: "cone", radius2: -0.5 }, error: "Cone top radius must be non-negative" },
        { extra: { primitive: "cone", height: -10 }, error: "Cone height must be positive" },
    ])("an explicitly invalid size is a rebuild error ($error)", ({ extra, error }) => {
        const body = bodyWith([primitive(extra as Partial<PrimitiveFeatureData>)]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe(error);
    });

    test("a join without a preceding feature is a rebuild error", () => {
        const body = bodyWith([primitive({ operation: "fuse" })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Primitive join/cut/intersect requires a preceding feature");
    });

    test("a join against a preceding feature booleans the two", () => {
        const body = bodyWith([primitive(), { ...primitive(), id: "f2", operation: "fuse" }]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.booleanFuse).toHaveBeenCalledTimes(1);
        expect(body.shape.unchecked()).toBe(mocks.fusedShape);
    });

    test("a lost direction builds from the frozen fingerprint and reports the loss", () => {
        const body = bodyWith([
            primitive({
                primitive: "cylinder",
                direction: {
                    nodeId: "deleted",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 1, z: 2 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        const normal = mocks.cylinder.mock.calls[0][0] as XYZ;
        const unit = Math.hypot(1, 2);
        expect([normal.x, normal.y, normal.z]).toEqual([0, 1 / unit, 2 / unit]);
        expect(body.featureItems()[0].missingInputs?.[0].key).toBe("direction");
    });

    test("a sphere ignores a direction override entirely — no build error, no missing-input row", () => {
        const body = bodyWith([
            primitive({
                primitive: "sphere",
                direction: {
                    nodeId: "deleted",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 1, z: 2 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[0].missingInputs).toBeUndefined();
    });

    test("the stored axis drives the build when there is no direction override", () => {
        const body = bodyWith([primitive({ primitive: "cylinder", axis: { x: 0, y: 0, z: -1 } })]);

        expect(body.shape.isOk).toBe(true);
        const normal = mocks.cylinder.mock.calls[0][0] as XYZ;
        expect([normal.x, normal.y, normal.z]).toEqual([0, 0, -1]);
    });

    test("the stored axis is normalized at resolve time; a degenerate one falls back to +Z", () => {
        const scaled = bodyWith([
            primitive({ id: "f-scaled", primitive: "cylinder", axis: { x: 0, y: 5, z: 0 } }),
        ]);
        const zero = bodyWith([
            primitive({ id: "f-zero", primitive: "cylinder", axis: { x: 0, y: 0, z: 0 } }),
        ]);

        expect(scaled.shape.isOk).toBe(true);
        expect(zero.shape.isOk).toBe(true);
        const [scaledNormal, zeroNormal] = mocks.cylinder.mock.calls.map((call) => call[0] as XYZ);
        expect([scaledNormal.x, scaledNormal.y, scaledNormal.z]).toEqual([0, 1, 0]);
        expect([zeroNormal.x, zeroNormal.y, zeroNormal.z]).toEqual([0, 0, 1]);
    });

    test("the direction override wins over the stored axis", () => {
        const body = bodyWith([
            primitive({
                primitive: "cylinder",
                axis: { x: 0, y: 0, z: -1 },
                direction: {
                    nodeId: "deleted",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 1, z: 2 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        const normal = mocks.cylinder.mock.calls[0][0] as XYZ;
        const unit = Math.hypot(1, 2);
        expect([normal.x, normal.y, normal.z]).toEqual([0, 1 / unit, 2 / unit]);
    });

    test("the box's construction frame follows the stored axis", () => {
        const body = bodyWith([primitive({ axis: { x: 1, y: 0, z: 0 } })]);

        expect(body.shape.isOk).toBe(true);
        const plane = mocks.box.mock.calls[0][0] as Plane;
        expect([plane.normal.x, plane.normal.y, plane.normal.z]).toEqual([1, 0, 0]);
        // The frame's x is the deterministic horizontal partner of the axis (+X's is −Y).
        expect([plane.xvec.x, plane.xvec.y, plane.xvec.z]).toEqual([0, -1, 0]);
    });

    test("a box seeds its faces by frame side and every edge by the faces it joins", () => {
        const body = bodyWith([primitive()]);

        expect(body.shape.isOk).toBe(true);
        expect([0, 1, 2, 3, 4, 5].map((i) => body.faceIdAt(i))).toEqual([
            "prim:f1:-z",
            "prim:f1:+z",
            "prim:f1:-x",
            "prim:f1:+x",
            "prim:f1:-y",
            "prim:f1:+y",
        ]);
        // Every box edge joins two named faces, so all twelve are named — the boundary id
        // sorts its pair ('+' < '-' in code-unit order).
        expect([...Array(12).keys()].map((i) => body.edgeIdAt(i))).toEqual([
            "prim:f1:-x&prim:f1:-z", // bottom × west
            "prim:f1:+x&prim:f1:-z", // bottom × east
            "prim:f1:-y&prim:f1:-z", // bottom × south
            "prim:f1:+y&prim:f1:-z", // bottom × north
            "prim:f1:+z&prim:f1:-x", // top × west
            "prim:f1:+x&prim:f1:+z", // top × east
            "prim:f1:+z&prim:f1:-y", // top × south
            "prim:f1:+y&prim:f1:+z", // top × north
            "prim:f1:-x&prim:f1:-y", // west × south
            "prim:f1:+y&prim:f1:-x", // west × north
            "prim:f1:+x&prim:f1:-y", // east × south
            "prim:f1:+x&prim:f1:+y", // east × north
        ]);
    });

    test("a cylinder seeds caps and the wall, but never the seam", () => {
        const body = bodyWith([primitive({ primitive: "cylinder" })]);

        expect(body.shape.isOk).toBe(true);
        expect([0, 1, 2].map((i) => body.faceIdAt(i))).toEqual([
            "prim:f1:bottom",
            "prim:f1:top",
            "prim:f1:lateral",
        ]);
        expect(body.edgeIdAt(0)).toBe("prim:f1:bottom&prim:f1:lateral");
        expect(body.edgeIdAt(1)).toBe("prim:f1:lateral&prim:f1:top");
        // The seam borders the lateral face on both sides — a conjunction of one names nothing.
        expect(body.edgeIdAt(2)).toBeUndefined();
    });
});
