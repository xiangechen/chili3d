// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, Plane, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/features"; // registers all feature handlers
import type { EdgeRef } from "../src/features/edgeRef";
import {
    type ExtrudeFeatureData,
    type FeatureData,
    featureHandler,
    type RevolveFeatureData,
} from "../src/features/feature";
import type { ProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";

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

/** The chain input's box every mock solid reports: z runs 0..10, so through-all reaches 10. */
const INPUT_BOX = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });

function setupMocks() {
    const solids: any[] = [];
    const solid = () => {
        const shape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: () => [],
            boundingBox: () => INPUT_BOX,
        };
        solids.push(shape);
        return shape;
    };
    const line = rs.fn((start: XYZ, end: XYZ) =>
        Result.ok({
            shapeType: ShapeTypes.edge,
            curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
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
        }),
    );
    const wire = rs.fn((edges: any[]) =>
        Result.ok({
            isClosed: () => edges.length > 1,
            edges,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const face = rs.fn((wires: any[]) => {
        const self: any = {
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            dispose: rs.fn(),
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
            transformedMul: () => self,
        };
        return Result.ok(self);
    });
    const prism = rs.fn((_face: any, _vec: XYZ) => Result.ok(solid()));
    const revolve = rs.fn((_face: any, _axis: any, _angle: number) => Result.ok(solid()));
    const fusedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const booleanFuse = rs.fn((_s1: any[], _s2: any[], _simplify: boolean) => Result.ok(fusedShape));
    // SketchNode.generateShape also combines (its entity edges).
    const combine = rs.fn((edges: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const restore = mockShapeFactory({ line, wire, face, prism, revolve, booleanFuse, combine });
    return { line, wire, face, prism, revolve, booleanFuse, combine, fusedShape, solids, restore };
}

describe("extrude end conditions", () => {
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

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    function extrude(extra: Partial<ExtrudeFeatureData> = {}): ExtrudeFeatureData {
        return { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5, ...extra };
    }

    /** The sweep vector of the n-th prism call. */
    function prismVec(call: number): XYZ {
        return (mocks.prism.mock.calls[call] as unknown as [any, XYZ])[1];
    }

    test("parameters: blind lists depth, end condition with its four choices, depth2, offsets", () => {
        const rows = featureHandler("extrude")!.parameters(extrude());

        expect(rows.map((x) => x.key)).toEqual([
            "depth",
            "endCondition",
            "depth2",
            "startOffset",
            "symmetric",
            "reverse",
            "draftAngle",
        ]);
        expect(rows[1].value).toBe("blind");
        expect(rows[1].choices?.map((x) => x.value)).toEqual([
            "blind",
            "throughAll",
            "upToFace",
            "upToVertex",
        ]);
    });

    test("parameters: an up-to condition adds the end offset row", () => {
        const rows = featureHandler("extrude")!.parameters(
            extrude({ endCondition: "upToFace", endOffset: 2 }),
        );

        expect(rows.map((x) => x.key)).toEqual([
            "depth",
            "endCondition",
            "endOffset",
            "depth2",
            "startOffset",
            "symmetric",
            "reverse",
            "draftAngle",
        ]);
        expect(rows[2].value).toBe(2);
    });

    test("parameters: symmetric drops the depth2 row", () => {
        const rows = featureHandler("extrude")!.parameters(extrude({ symmetric: true }));

        expect(rows.map((x) => x.key)).toEqual([
            "depth",
            "endCondition",
            "startOffset",
            "symmetric",
            "reverse",
            "draftAngle",
        ]);
    });

    test("setParameter: a known end condition is stored, an unknown one rejected", () => {
        const handler = featureHandler("extrude")!;
        const feature = extrude();

        expect(handler.setParameter(feature, "endCondition", "upToVertex").endCondition).toBe("upToVertex");
        expect(handler.setParameter(feature, "endCondition", "bogus")).toBe(feature);
    });

    test("setParameter: the reverse toggle coerces like the symmetric one", () => {
        const handler = featureHandler("extrude")!;
        const feature = extrude();

        expect(handler.setParameter(feature, "reverse", true).reverse).toBe(true);
        expect(handler.setParameter(feature, "reverse", "true").reverse).toBe(true);
        expect(handler.setParameter({ ...feature, reverse: true }, "reverse", false).reverse).toBe(false);
    });

    test("setParameter: switching symmetric on drops a stored depth2 instead of conflicting", () => {
        const handler = featureHandler("extrude")!;
        const updated = handler.setParameter(extrude({ depth2: 3 }), "symmetric", true);

        expect(updated.symmetric).toBe(true);
        expect("depth2" in updated).toBe(false);
        // The stored result rebuilds clean — no "cannot be both" guard trip.
        const body = bodyWith([updated]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect(body.shape.isOk).toBe(true);
    });

    test("nodeIds covers the end targets and the direction, deduped", () => {
        const feature = extrude({
            endFace: { nodeId: "a", profile: { edges: [] } },
            endVertex: { nodeId: "b", vertex: { point: { x: 0, y: 0, z: 1 } } },
            direction: {
                nodeId: "a",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1 } },
            },
        });

        expect(featureHandler("extrude")!.nodeIds(feature)).toEqual([sketch.id, "a", "b"]);
    });

    test("references lists a door per referenced node", () => {
        const feature = extrude({
            endFace: { nodeId: "a", profile: { edges: [] } },
            endVertex: { nodeId: "b", vertex: { point: { x: 0, y: 0, z: 1 } } },
            direction: {
                nodeId: "c",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1 } },
            },
        });

        const refs = featureHandler("extrude")!.references?.(feature);
        expect(refs?.map((x) => [x.key, x.display, x.nodeId])).toEqual([
            ["sketchId", "body.sketch", sketch.id],
            ["endFace", "feature.extrude.endFace", "a"],
            ["endVertex", "feature.extrude.endVertex", "b"],
            ["direction", "feature.extrude.direction", "c"],
        ]);
    });

    test("applyResolvedRefs writes the direction, end-face and end-vertex anchors back", () => {
        const handler = featureHandler("extrude")!;
        const feature = extrude({
            direction: {
                nodeId: "c",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1 } },
            },
            endFace: { nodeId: "a", profile: { edges: [] } },
            endVertex: { nodeId: "b", vertex: { point: { x: 0, y: 0, z: 1 } } },
        });
        const edge: EdgeRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } };
        const profile: ProfileRef = { edges: [], center: { x: 0, y: 0, z: 2 } };

        expect(handler.applyResolvedRefs!(feature, {})).toBe(feature);
        const next = handler.applyResolvedRefs!(feature, {
            resolvedEdges: [edge],
            resolvedTargets: { endFace: profile, endVertex: { point: { x: 1, y: 2, z: 3 } } },
        });
        expect(next.direction?.edge).toBe(edge);
        expect(next.endFace?.profile).toBe(profile);
        expect(next.endVertex?.vertex).toEqual({ point: { x: 1, y: 2, z: 3 } });
    });

    test("symmetric and a second depth together are a rebuild error, not a silent winner", () => {
        const body = bodyWith([extrude({ symmetric: true, depth2: 3 })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Extrude cannot be both symmetric and have a second depth");
    });

    test("a non-positive second depth is a rebuild error", () => {
        const body = bodyWith([extrude({ depth2: 0 })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Extrude depth2 must be positive");
    });

    test("through-all requires a preceding feature", () => {
        const body = bodyWith([extrude({ endCondition: "throughAll" })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Extrude through-all requires a preceding feature");
    });

    test("through-all sweeps past the chain input's far side, plus the margin", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 },
            { id: "f2", type: "extrude", sketchId: sketch.id, depth: 1, endCondition: "throughAll" },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBe(10);
        expect(prismVec(1).z).toBeCloseTo(10.001, 9);
    });

    test.each([
        { endOffset: undefined, expected: 30 },
        { endOffset: -5, expected: 25 },
    ])("up-to-vertex lands the end plane on the point (endOffset $endOffset)", ({ endOffset, expected }) => {
        const body = bodyWith([
            extrude({
                endCondition: "upToVertex",
                endVertex: { nodeId: "deleted", vertex: { point: { x: 0, y: 0, z: 30 } } },
                endOffset,
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBeCloseTo(expected, 9);
        // The node is gone: the frozen fingerprint carried the depth, and the row reports the loss.
        expect(body.featureItems()[0].missingInputs?.[0].key).toBe("endVertex");
    });

    test("an up-to-vertex target behind the start plane is a rebuild error", () => {
        const body = bodyWith([
            extrude({
                endCondition: "upToVertex",
                endVertex: { nodeId: "deleted", vertex: { point: { x: 0, y: 0, z: -10 } } },
            }),
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe(
            "Extrude target lies behind the start plane — flip reverse to reach it",
        );
    });

    test("up-to-face: a lost node's frozen fingerprint drives the depth when it is parallel", () => {
        const body = bodyWith([
            extrude({
                endCondition: "upToFace",
                endFace: {
                    nodeId: "deleted",
                    profile: { edges: [], center: { x: 0, y: 0, z: 20 }, normal: { x: 0, y: 0, z: 1 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBeCloseTo(20, 9);
        expect(body.featureItems()[0].missingInputs?.[0].key).toBe("endFace");
    });

    test("up-to-face: a ref without even a center falls back to the blind depth", () => {
        const body = bodyWith([
            extrude({
                endCondition: "upToFace",
                endFace: { nodeId: "deleted", profile: { edges: [] } },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBe(5);
        expect(body.featureItems()[0].missingInputs?.[0].key).toBe("endFace");
    });

    test("the start offset composes first: the up-to depth is measured from the profile plane", () => {
        const body = bodyWith([
            extrude({
                startOffset: 5,
                endCondition: "upToVertex",
                endVertex: { nodeId: "deleted", vertex: { point: { x: 0, y: 0, z: 30 } } },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        // reach 30 − startOffset 5 — the end still lands on z = 30.
        expect(prismVec(0).z).toBeCloseTo(25, 9);
    });

    test("the start offset composes first under through-all too", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 },
            {
                id: "f2",
                type: "extrude",
                sketchId: sketch.id,
                depth: 1,
                endCondition: "throughAll",
                startOffset: 4,
            },
        ]);

        expect(body.shape.isOk).toBe(true);
        // Far side 10 − startOffset 4 + margin.
        expect(prismVec(1).z).toBeCloseTo(6.001, 9);
    });

    test("the start offset composes first for a parallel up-to face", () => {
        const body = bodyWith([
            extrude({
                startOffset: 5,
                endCondition: "upToFace",
                endFace: {
                    nodeId: "deleted",
                    profile: { edges: [], center: { x: 0, y: 0, z: 20 }, normal: { x: 0, y: 0, z: 1 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        // reach 20 − startOffset 5 — the end still lands on z = 20.
        expect(prismVec(0).z).toBeCloseTo(15, 9);
    });

    // The start offset keeps the UNFLIPPED sense (it rides the plane normal), so with reverse
    // set the start plane sits behind the profile plane along the sweep and the depth is
    // reach + startOffset — not reach − startOffset.
    test("reverse + start offset + up-to vertex: the depth extends by the offset", () => {
        const body = bodyWith([
            extrude({
                startOffset: 10,
                reverse: true,
                endCondition: "upToVertex",
                endVertex: { nodeId: "deleted", vertex: { point: { x: 0, y: 0, z: -10 } } },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        // Start plane at z = +10 (unflipped sense), target at z = −10 along −Z: 10 + 10 = 20.
        expect(prismVec(0).z).toBeCloseTo(-20, 9);
    });

    test("reverse + start offset + up-to face (parallel): the depth extends by the offset", () => {
        const body = bodyWith([
            extrude({
                startOffset: 10,
                reverse: true,
                endCondition: "upToFace",
                endFace: {
                    nodeId: "deleted",
                    profile: { edges: [], center: { x: 0, y: 0, z: -20 }, normal: { x: 0, y: 0, z: 1 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        // reach 20 + startOffset 10, sweeping −Z — the end lands on z = −20.
        expect(prismVec(0).z).toBeCloseTo(-30, 9);
    });

    test("reverse + start offset + through-all: the run extends by the offset", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 },
            {
                id: "f2",
                type: "extrude",
                sketchId: sketch.id,
                depth: 1,
                endCondition: "throughAll",
                startOffset: 10,
                reverse: true,
            },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBe(10);
        // The flipped far side is z = 0 (reach 0); the start plane sits at z = +10, so the
        // run is the offset plus the margin.
        expect(prismVec(1).z).toBeCloseTo(-10.001, 9);
    });

    test("a direction override parallel to the profile plane is a rebuild error", () => {
        const body = bodyWith([
            extrude({
                direction: {
                    nodeId: "deleted",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Extrude direction is parallel to the profile plane");
    });

    test("a lost direction keeps building from the frozen fingerprint and reports the loss", () => {
        const body = bodyWith([
            extrude({
                depth: 5,
                direction: {
                    nodeId: "deleted",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 1, z: 2 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        const vec = prismVec(0);
        const unit = Math.hypot(1, 2);
        expect([vec.x, vec.y, vec.z]).toEqual([0, 5 / unit, 10 / unit]);
        expect(body.featureItems()[0].missingInputs?.[0].key).toBe("direction");
    });

    test("a second depth sweeps the flipped direction and the halves fuse", () => {
        const body = bodyWith([extrude({ depth2: 4 })]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prism).toHaveBeenCalledTimes(2);
        expect([prismVec(0).x, prismVec(0).y, prismVec(0).z]).toEqual([0, 0, 5]);
        // The backward vector: (−0, −0, −4) — assert the magnitude, not the zero's sign.
        expect(prismVec(1).z).toBe(-4);
        expect(prismVec(1).x).toBeCloseTo(0, 12);
        expect(prismVec(1).y).toBeCloseTo(0, 12);
        expect(body.shape.unchecked()).toBe(mocks.fusedShape);
    });

    test("reverse sweeps a blind depth to the other side of the profile plane", () => {
        const body = bodyWith([extrude({ reverse: true })]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBe(-5);
    });

    test("reverse reaches an up-to target behind the start plane", () => {
        const body = bodyWith([
            extrude({
                endCondition: "upToVertex",
                endVertex: { nodeId: "deleted", vertex: { point: { x: 0, y: 0, z: -10 } } },
                reverse: true,
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBeCloseTo(-10, 9);
    });

    test("with reverse, a target on the natural side is the one behind the start plane", () => {
        const body = bodyWith([
            extrude({
                endCondition: "upToVertex",
                endVertex: { nodeId: "deleted", vertex: { point: { x: 0, y: 0, z: 30 } } },
                reverse: true,
            }),
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe(
            "Extrude target lies behind the start plane — flip reverse to reach it",
        );
    });

    test("through-all with reverse measures toward the flipped far side", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 },
            {
                id: "f2",
                type: "extrude",
                sketchId: sketch.id,
                depth: 1,
                endCondition: "throughAll",
                reverse: true,
            },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBe(10);
        // The input's box starts ON the profile plane, so the flipped far side is only
        // the through-all margin away.
        expect(prismVec(1).z).toBeCloseTo(-0.001, 9);
    });

    test("a second depth still lands opposite the main sweep — the natural side, reversed", () => {
        const body = bodyWith([extrude({ depth2: 4, reverse: true })]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prism).toHaveBeenCalledTimes(2);
        expect(prismVec(0).z).toBe(-5);
        expect(prismVec(1).z).toBe(4);
    });

    test("symmetric with reverse mirrors the pair — the halves swap sides, not identities", () => {
        const body = bodyWith([extrude({ symmetric: true, reverse: true })]);

        expect(body.shape.isOk).toBe(true);
        expect(prismVec(0).z).toBe(-5);
        expect(prismVec(1).z).toBe(5);
    });

    test("a direction override's sense flips with reverse", () => {
        const body = bodyWith([
            extrude({
                depth: 5,
                reverse: true,
                direction: {
                    nodeId: "deleted",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 1, z: 2 } },
                },
            }),
        ]);

        expect(body.shape.isOk).toBe(true);
        const vec = prismVec(0);
        const unit = Math.hypot(1, 2);
        expect(vec.x).toBeCloseTo(0, 12);
        expect(vec.y).toBeCloseTo(-5 / unit, 9);
        expect(vec.z).toBeCloseTo(-10 / unit, 9);
    });

    test("the draft pull follows the sweep direction, so reverse flips the narrow end", () => {
        // A prism exposing one side face (a mid-height vertex, on neither cap plane), so
        // the taper has something to rotate; the draft mock captures its pull direction.
        const sideFace = {
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.vertex ? [{ point: () => new XYZ({ x: 0.5, y: 0.5, z: 2.5 }) }] : [],
        };
        const prismSolid = () => ({
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? [sideFace] : []),
            boundingBox: () => INPUT_BOX,
        });
        mocks.prism.mockImplementation((() => Result.ok(prismSolid())) as any);
        mocks.face.mockImplementation(((wires: any[]) => {
            const self: any = {
                shapeType: ShapeTypes.face,
                isEqual: () => false,
                dispose: rs.fn(),
                outerWire: () => wires[0],
                normal: () => [XYZ.zero, XYZ.unitZ],
                findSubShapes: (type: ShapeType) =>
                    type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
                area: () => 0,
                boundingBox: () => BoundingBox.zero,
                transformedMul: () => self,
            };
            return Result.ok(self);
        }) as any);
        const draft = rs.fn((_shape: any, _faces: any[], _direction: XYZ, _angle: number, _plane: any) =>
            Result.ok(prismSolid()),
        );
        (globalThis as any).shapeFactory.draft = draft;

        const straight = bodyWith([extrude({ draftAngle: 5 })]);
        const reversed = bodyWith([extrude({ draftAngle: 5, reverse: true })]);

        expect(straight.shape.isOk).toBe(true);
        expect(reversed.shape.isOk).toBe(true);
        expect(draft).toHaveBeenCalledTimes(2);
        expect((draft.mock.calls[0] as unknown as [any, any, XYZ])[2].z).toBe(1);
        expect((draft.mock.calls[1] as unknown as [any, any, XYZ])[2].z).toBe(-1);
    });
});

describe("revolve two-sided angles", () => {
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

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    function revolveFeature(extra: Partial<RevolveFeatureData> = {}): RevolveFeatureData {
        return {
            id: "f1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            angle: 90,
            ...extra,
        };
    }

    /** The (axis, angle) pairs the revolve mock was called with. */
    function revolveCalls(): { direction: XYZ; angle: number }[] {
        return (mocks.revolve.mock.calls as unknown as [any, { direction: XYZ }, number][]).map((call) => ({
            direction: call[1].direction,
            angle: call[2],
        }));
    }

    test("parameters: angle, second angle and the symmetric toggle", () => {
        const rows = featureHandler("revolve")!.parameters(revolveFeature());

        expect(rows.map((x) => x.key)).toEqual(["angle", "angle2", "symmetric"]);
        expect(
            featureHandler("revolve")!
                .parameters(revolveFeature({ symmetric: true }))
                .map((x) => x.key),
        ).toEqual(["angle", "symmetric"]);
    });

    test("setParameter: the symmetric toggle coerces like the extrude one", () => {
        const handler = featureHandler("revolve")!;
        expect(handler.setParameter(revolveFeature(), "symmetric", "true").symmetric).toBe(true);
        expect(handler.setParameter(revolveFeature(), "angle2", 30).angle2).toBe(30);
    });

    test("setParameter: switching symmetric on drops a stored angle2 instead of conflicting", () => {
        const handler = featureHandler("revolve")!;
        const updated = handler.setParameter(revolveFeature({ angle2: 30 }), "symmetric", true);

        expect(updated.symmetric).toBe(true);
        expect("angle2" in updated).toBe(false);
        // The stored result rebuilds clean — no "cannot be both" guard trip.
        const body = bodyWith([updated]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect(body.shape.isOk).toBe(true);
    });

    test("symmetric and a second angle together are a rebuild error", () => {
        const body = bodyWith([revolveFeature({ symmetric: true, angle2: 30 })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Revolve cannot be both symmetric and have a second angle");
    });

    test.each([0, -30])("a non-positive second angle (%s) is a rebuild error", (angle2) => {
        const body = bodyWith([revolveFeature({ angle2 })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Revolve angle2 must be positive");
    });

    test("symmetric sweeps half the total angle to each side of the profile plane", () => {
        const body = bodyWith([revolveFeature({ symmetric: true, angle: 90 })]);

        expect(body.shape.isOk).toBe(true);
        const calls = revolveCalls();
        expect(calls.length).toBe(2);
        expect(calls[0].angle).toBe(45);
        expect(calls[0].direction.y).toBe(1);
        expect(calls[1].angle).toBe(45);
        // The backward half sweeps the flipped axis by a positive angle.
        expect(calls[1].direction.y).toBe(-1);
    });

    test("a second angle sweeps the flipped axis by its own angle", () => {
        const body = bodyWith([revolveFeature({ angle: 90, angle2: 30 })]);

        expect(body.shape.isOk).toBe(true);
        const calls = revolveCalls();
        expect(calls.length).toBe(2);
        expect([calls[0].angle, calls[0].direction.y]).toEqual([90, 1]);
        expect([calls[1].angle, calls[1].direction.y]).toEqual([30, -1]);
    });

    test("single-sided revolves exactly once, as before", () => {
        const body = bodyWith([revolveFeature()]);

        expect(body.shape.isOk).toBe(true);
        expect(revolveCalls().length).toBe(1);
    });
});
