// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IEdge,
    type IFace,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { nearestOnCircle, nearestOnSegment } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { allProfiles, resolveProfiles, sketchProfiles } from "../src/features/profileBuilder";
import { captureProfileRef } from "../src/features/profileRef";
import type { SketchNode } from "../src/sketch";

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

function edge(x1: number, y1: number, x2: number, y2: number): IEdge {
    const start = new XYZ({ x: x1, y: y1, z: 0 });
    const end = new XYZ({ x: x2, y: y2, z: 0 });
    return {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: x2 - x1, y: y2 - y1, z: 0 } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
        },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: (other: IEdge) => segmentIntersect(start, end, other.startPoint(), other.endPoint()),
        boundingBox: () =>
            new BoundingBox(
                new XYZ({ x: Math.min(x1, x2), y: Math.min(y1, y2), z: 0 }),
                new XYZ({ x: Math.max(x1, x2), y: Math.max(y1, y2), z: 0 }),
            ),
    } as unknown as IEdge;
}

/** 2D segment-segment intersection of p1p2 with p3p4, as `IEdge.intersect` results. */
function segmentIntersect(p1: XYZ, p2: XYZ, p3: XYZ, p4: XYZ): { parameter: number; point: XYZ }[] {
    const d = { x: p2.x - p1.x, y: p2.y - p1.y };
    const e = { x: p4.x - p3.x, y: p4.y - p3.y };
    const denom = d.x * e.y - d.y * e.x;
    if (Math.abs(denom) < 1e-12) return []; // parallel
    const t = ((p3.x - p1.x) * e.y - (p3.y - p1.y) * e.x) / denom;
    const u = ((p3.x - p1.x) * d.y - (p3.y - p1.y) * d.x) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return [];
    return [{ parameter: t, point: new XYZ({ x: p1.x + t * d.x, y: p1.y + t * d.y, z: 0 }) }];
}

function square(x1: number, y1: number, x2: number, y2: number): IEdge[] {
    return [edge(x1, y1, x2, y1), edge(x2, y1, x2, y2), edge(x2, y2, x1, y2), edge(x1, y2, x1, y1)];
}

/** Unit square as four connected edges, intentionally unordered. */
function squareEdges(): IEdge[] {
    const [a, b, c, d] = square(0, 0, 1, 1);
    return [d, b, a, c];
}

function sketchWith(edges: IEdge[]): SketchNode {
    return sketchWithIds(
        edges,
        edges.map((_, index) => index + 1),
    );
}

function sketchWithIds(edges: IEdge[], ids: number[]): SketchNode {
    const compound = {
        shapeType: ShapeTypes.compound,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
    };
    return {
        shape: Result.ok(compound),
        plane: Plane.XY,
        // generateShape pushes one edge per entity in `data.entities` order, so the
        // collected edge index corresponds to the entity index.
        data: { entities: edges.map((_, index) => ({ id: ids[index], type: "line", params: [] })) },
    } as unknown as SketchNode;
}

function faceOf(edges: IEdge[]): IFace {
    return {
        shapeType: ShapeTypes.face,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        outerWire: () => ({
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
        // Zero region fingerprint: disables the region-similarity fallback in matching.
        area: () => 0,
        boundingBox: () => BoundingBox.zero,
    } as unknown as IFace;
}

/** wire() keeps its edges; face() exposes the boundary edges of all its wires. */
function setup(closed = true) {
    const wire = rs.fn((edges: IEdge[]) =>
        Result.ok({
            isClosed: () => closed,
            edges,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const face = rs.fn((wires: { edges: IEdge[] }[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            wires,
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w) => w.edges) : [],
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        }),
    );
    const restore = mockShapeFactory({ wire, face });
    return { wire, face, restore };
}

describe("sketchProfiles", () => {
    test("builds one outer face from an unordered connected loop", () => {
        const { wire, face, restore } = setup();
        try {
            const result = sketchProfiles(sketchWith(squareEdges()));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            expect(result.unchecked()!.inner.length).toBe(0);
            expect(wire).toHaveBeenCalledTimes(1);
            expect((wire.mock.calls[0] as unknown as [IEdge[]])[0].length).toBe(4);
            expect((face.mock.calls[0] as unknown as [IEdge[][]])[0].length).toBe(1);
        } finally {
            restore();
        }
    });

    test("splits disjoint loops into separate outer faces", () => {
        const { wire, restore } = setup();
        try {
            const result = sketchProfiles(sketchWith([...squareEdges(), ...square(10, 10, 12, 12)]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(2);
            expect(result.unchecked()!.inner.length).toBe(0);
            expect(wire).toHaveBeenCalledTimes(2);
        } finally {
            restore();
        }
    });

    test("a nested loop becomes a hole of the outer profile", () => {
        const { face, restore } = setup();
        try {
            const result = sketchProfiles(sketchWith([...square(0, 0, 10, 10), ...square(2, 2, 3, 3)]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            expect(result.unchecked()!.inner.length).toBe(1);
            // The outer profile's face is built from its wire plus the hole wire; the
            // hole boundary edges are part of the outer face (8 = 4 outer + 4 hole).
            const outerCall = face.mock.calls.find((c) => (c[0] as any[]).length === 2);
            expect(outerCall).toBeDefined();
            expect(result.unchecked()!.outer[0].findSubShapes(ShapeTypes.edge).length).toBe(8);
            expect(result.unchecked()!.inner[0].findSubShapes(ShapeTypes.edge).length).toBe(4);
        } finally {
            restore();
        }
    });

    test("a hole straddling the grouping diagonal is still a hole", () => {
        const { restore } = setup();
        try {
            // The outer square's edges are sampled in grouping order, not loop order,
            // so the containment polygon picks up a diagonal chord (0,0)-(10,10). A hole
            // centred on that chord is then misclassified as an independent solid profile.
            const result = sketchProfiles(
                sketchWith([...square(0, 0, 10, 10), ...square(4.5, 4.5, 5.5, 5.5)]),
            );

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            expect(result.unchecked()!.inner.length).toBe(1);
        } finally {
            restore();
        }
    });

    test("a loop inside a hole is an island profile of its own", () => {
        const { restore } = setup();
        try {
            const result = sketchProfiles(
                sketchWith([...square(0, 0, 10, 10), ...square(2, 2, 8, 8), ...square(3, 3, 4, 4)]),
            );

            expect(result.isOk).toBe(true);
            // Outer square (with the middle loop as its hole) and the island are both
            // default profiles; the middle ring is only selectable.
            expect(result.unchecked()!.outer.length).toBe(2);
            expect(result.unchecked()!.inner.length).toBe(1);
            expect(allProfiles(result.unchecked()!).length).toBe(3);
        } finally {
            restore();
        }
    });

    test("accepts a single closed edge shape directly", () => {
        const { wire, restore } = setup();
        try {
            const circle = edge(0, 0, 0, 0);
            const sketch = {
                shape: Result.ok(circle),
                plane: Plane.XY,
                data: { entities: [{ id: 1, type: "line", params: [] }] },
            } as unknown as SketchNode;

            const result = sketchProfiles(sketch);

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            expect((wire.mock.calls[0] as unknown as [IEdge[]])[0]).toEqual([circle]);
        } finally {
            restore();
        }
    });

    test("fails on an open profile", () => {
        const { restore } = setup(false);
        try {
            const result = sketchProfiles(sketchWith(squareEdges()));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Sketch profile is not closed");
        } finally {
            restore();
        }
    });

    test("ignores a dangling open chain next to a closed loop", () => {
        const restore = mockShapeFactory({
            // closed ⇔ the group chains back onto itself (the lone line does not)
            wire: rs.fn((edges: IEdge[]) =>
                Result.ok({
                    isClosed: () => edges.length > 1,
                    edges,
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            ),
            face: rs.fn((wires: { edges: IEdge[] }[]) =>
                Result.ok({
                    shapeType: ShapeTypes.face,
                    wires,
                    outerWire: () => wires[0],
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.edge ? wires.flatMap((w) => w.edges) : [],
                }),
            ),
        });
        try {
            const danglingLine = edge(5, 5, 8, 8);
            const result = sketchProfiles(sketchWith([...squareEdges(), danglingLine]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
        } finally {
            restore();
        }
    });

    test("fails when the sketch has no entities", () => {
        const { restore } = setup();
        try {
            const result = sketchProfiles(sketchWith([]));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Sketch has no entities");
        } finally {
            restore();
        }
    });

    test("propagates wire factory errors", () => {
        const restore = mockShapeFactory({ wire: () => Result.err("wire failed") });
        try {
            const result = sketchProfiles(sketchWith(squareEdges()));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("wire failed");
        } finally {
            restore();
        }
    });

    test("propagates face factory errors", () => {
        const restore = mockShapeFactory({
            wire: (edges: IEdge[]) => Result.ok({ isClosed: () => true, edges }),
            face: () => Result.err("face failed"),
        });
        try {
            const result = sketchProfiles(sketchWith(squareEdges()));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("face failed");
        } finally {
            restore();
        }
    });
});

describe("sketchProfiles with crossing edges", () => {
    function setupCrossing(faces: IFace[] | string) {
        const wire = rs.fn((edges: IEdge[]) => Result.ok({ isClosed: () => true, edges }));
        const face = rs.fn((wires: { edges: IEdge[] }[]) =>
            Result.ok({
                shapeType: ShapeTypes.face,
                findSubShapes: (type: ShapeType) =>
                    type === ShapeTypes.edge ? wires.flatMap((w) => w.edges) : [],
            }),
        );
        const facesFromEdges = rs.fn((_edges: IEdge[], _plane: Plane) =>
            typeof faces === "string"
                ? Result.err(faces)
                : Result.ok({ faces, sources: faces.map(() => [] as number[]) }),
        );
        const restore = mockShapeFactory({ wire, face, facesFromEdges });
        return { wire, facesFromEdges, restore };
    }

    test("the crossing path maps the kernel's source edge indexes to entity ids", () => {
        const regions = [faceOf([]), faceOf([])];
        const facesFromEdges = rs.fn((_edges: IEdge[], _plane: Plane) =>
            Result.ok({
                faces: regions,
                sources: [
                    [4, 0],
                    [1, 7],
                ],
            }),
        );
        const restore = mockShapeFactory({ facesFromEdges });
        try {
            const edges = [...square(0, 0, 2, 2), ...square(1, 1, 3, 3)];
            const result = sketchProfiles(sketchWith(edges));

            expect(result.isOk).toBe(true);
            // Edge index i is entity id i+1 (mock order); sets come back sorted by id.
            expect(result.unchecked()!.outerEntities).toEqual([
                [1, 5],
                [2, 8],
            ]);
            // Registered on the returned faces, so captureProfileRef picks them up.
            expect(captureProfileRef(regions[0]).entities).toEqual([1, 5]);
            expect(captureProfileRef(regions[1]).entities).toEqual([2, 8]);
        } finally {
            restore();
        }
    });

    test("two overlapping squares without shared endpoints yield the kernel's regions", () => {
        const regions = [faceOf([]), faceOf([]), faceOf([])];
        const { wire, facesFromEdges, restore } = setupCrossing(regions);
        try {
            const edges = [...square(0, 0, 2, 2), ...square(1, 1, 3, 3)];
            const result = sketchProfiles(sketchWith(edges));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer).toEqual(regions);
            expect(result.unchecked()!.inner.length).toBe(0);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            const call = facesFromEdges.mock.calls[0] as unknown as [IEdge[], Plane];
            expect(call[0]).toEqual(edges);
            expect(call[1]).toBe(Plane.XY);
            // The connectivity grouping path must be bypassed entirely.
            expect(wire).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("endpoint-touching loops keep the connectivity path", () => {
        const { wire, facesFromEdges, restore } = setupCrossing([]);
        try {
            const result = sketchProfiles(sketchWith(squareEdges()));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            expect(wire).toHaveBeenCalledTimes(1);
            expect(facesFromEdges).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("a divider ending mid-span on the rectangle's edges goes through the kernel", () => {
        const regions = [faceOf([]), faceOf([])];
        const { wire, facesFromEdges, restore } = setupCrossing(regions);
        try {
            // The divider's two endpoints land on the rectangle's top/bottom edges (a
            // T-junction, not a crossing) — the rectangle must split into two regions.
            const rect = square(0, 0, 10, 10);
            const divider = edge(5, 0, 5, 10);
            const result = sketchProfiles(sketchWith([...rect, divider]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer).toEqual(regions);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            expect(wire).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("a divider ending a hair off the rectangle's edge still goes through the kernel", () => {
        const regions = [faceOf([]), faceOf([])];
        const { wire, facesFromEdges, restore } = setupCrossing(regions);
        try {
            // Both endpoints stop 5e-8 short of the bottom/top edges (solver residual
            // scale): intersect() sees nothing at either end, but each endpoint lies on
            // the edge's interior within Precision.Distance, so the kernel must split it.
            const rect = square(0, 0, 10, 10);
            const divider = edge(5, 5e-8, 5, 10 - 5e-8);
            const result = sketchProfiles(sketchWith([...rect, divider]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer).toEqual(regions);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            expect(wire).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("a divider ending within INCIDENCE_TOLERANCE of the rectangle's edge goes through the kernel", () => {
        const regions = [faceOf([]), faceOf([])];
        const { wire, facesFromEdges, restore } = setupCrossing(regions);
        try {
            // Both endpoints stop 5e-5 short of the bottom/top edges: beyond
            // Precision.Distance but within the solver's incidence-residual scale, so
            // the endpoint-on-interior probe must still route the sketch to the kernel.
            const rect = square(0, 0, 10, 10);
            const divider = edge(5, 5e-5, 5, 10 - 5e-5);
            const result = sketchProfiles(sketchWith([...rect, divider]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer).toEqual(regions);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            expect(wire).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("an endpoint within INCIDENCE_TOLERANCE of a vertex splits without a curve query", () => {
        const regions = [faceOf([])];
        const { facesFromEdges, restore } = setupCrossing(regions);
        try {
            // The divider's foot sits 5e-5 off the bottom edge's left corner — beyond a
            // plain vertex contact, but within INCIDENCE_TOLERANCE of the corner, so the
            // endpoint distances alone settle the contact: no curve query runs at all.
            const bottom = edge(0, 0, 10, 0);
            const divider = edge(5e-5, 5e-5, 5e-5, 10);
            const nearestBottom = rs.spyOn(bottom.curve, "nearestFromPoint");
            const nearestDivider = rs.spyOn(divider.curve, "nearestFromPoint");

            const result = sketchProfiles(sketchWith([bottom, divider]));

            expect(result.isOk).toBe(true);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            expect(nearestBottom).not.toHaveBeenCalled();
            expect(nearestDivider).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("a line partially overlapping another collinearly goes through the kernel", () => {
        const regions = [faceOf([])];
        const { wire, facesFromEdges, restore } = setupCrossing(regions);
        try {
            // The redrawn bottom sits exactly on the rectangle's bottom edge between
            // the corners: parallel curves report no intersection, but its endpoints
            // lie on the bottom edge's interior (a collinear overlap splits the edge).
            const rect = square(0, 0, 10, 10);
            const redrawnBottom = edge(2, 0, 8, 0);
            const result = sketchProfiles(sketchWith([...rect, redrawnBottom]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer).toEqual(regions);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            expect(wire).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("propagates facesFromEdges errors", () => {
        const { restore } = setupCrossing("faces failed");
        try {
            const result = sketchProfiles(sketchWith([...square(0, 0, 2, 2), ...square(1, 1, 3, 3)]));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("faces failed");
        } finally {
            restore();
        }
    });
});

describe("resolveProfiles", () => {
    const OUTER = square(0, 0, 10, 10);
    const HOLE = square(2, 2, 3, 3);

    function circleEdge(cx: number, cy: number, radius: number): IEdge {
        return {
            shapeType: ShapeTypes.edge,
            curve: {
                basisCurve: { center: { x: cx, y: cy, z: 0 }, radius, axis: { x: 0, y: 0, z: 1 } },
                nearestFromPoint: (point: XYZ) =>
                    nearestOnCircle(new XYZ({ x: cx, y: cy, z: 0 }), radius, point),
            },
            startPoint: () => new XYZ({ x: cx + radius, y: cy, z: 0 }),
            endPoint: () => new XYZ({ x: cx + radius, y: cy, z: 0 }),
            firstParameter: () => 0,
            lastParameter: () => Math.PI * 2,
            pointAt: (t: number) =>
                new XYZ({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t), z: 0 }),
            // The test circles never intersect anything; a real kernel would return [] too.
            intersect: () => [],
            boundingBox: () =>
                new BoundingBox(
                    new XYZ({ x: cx - radius, y: cy - radius, z: 0 }),
                    new XYZ({ x: cx + radius, y: cy + radius, z: 0 }),
                ),
        } as unknown as IEdge;
    }

    test("two disjoint circles of the same radius are distinct profiles", () => {
        const { restore } = setup();
        try {
            // Regression: selecting one circle falsely reported an ambiguous match.
            const circleA = circleEdge(0, 0, 5);
            const circleB = circleEdge(30, 0, 5);
            const sketch = sketchWith([circleA, circleB]);
            const faces = allProfiles(sketchProfiles(sketch).unchecked()!);
            expect(faces.length).toBe(2);

            const ref = captureProfileRef(faceOf([circleB]));
            const result = resolveProfiles(sketch, [ref]);

            expect(result.isOk).toBe(true);
            const resolved = result.unchecked()!;
            expect(resolved.length).toBe(1);
            // Faces come from a separate sketchProfiles call, so compare by content.
            expect(resolved[0].face.findSubShapes(ShapeTypes.edge)).toEqual([circleB]);
            expect(faces[resolved[0].index].findSubShapes(ShapeTypes.edge)).toEqual([circleB]);
        } finally {
            restore();
        }
    });

    test("resolves the outer profiles only when no profiles are given", () => {
        const { restore } = setup();
        try {
            const result = resolveProfiles(sketchWith([...OUTER, ...HOLE]));

            expect(result.isOk).toBe(true);
            const resolved = result.unchecked()!;
            expect(resolved.length).toBe(1);
            expect(resolved[0].index).toBe(0);
            expect(resolved[0].face.findSubShapes(ShapeTypes.edge).length).toBe(8);
        } finally {
            restore();
        }
    });

    test("an explicitly referenced hole loop resolves as a solid profile", () => {
        const { restore } = setup();
        try {
            const ref = captureProfileRef(faceOf(HOLE));
            const result = resolveProfiles(sketchWith([...OUTER, ...HOLE]), [ref]);

            expect(result.isOk).toBe(true);
            const resolved = result.unchecked()!;
            expect(resolved.length).toBe(1);
            // The inner loop follows the outer ones in the combined profile list.
            expect(resolved[0].index).toBe(1);
            expect(resolved[0].face.findSubShapes(ShapeTypes.edge).length).toBe(4);
        } finally {
            restore();
        }
    });

    test("resolves the referenced subset, keeping the profile list indexes", () => {
        const { restore } = setup();
        try {
            const second = square(20, 20, 22, 22);
            const sketch = sketchWith([...squareEdges(), ...second]);
            const faces = allProfiles(sketchProfiles(sketch).unchecked()!);
            const ref = captureProfileRef(faceOf(second));

            const result = resolveProfiles(sketch, [ref]);

            expect(result.isOk).toBe(true);
            const resolved = result.unchecked()!;
            expect(resolved.length).toBe(1);
            expect(new Set(resolved[0].face.findSubShapes(ShapeTypes.edge))).toEqual(new Set(second));
            expect(faces[resolved[0].index].findSubShapes(ShapeTypes.edge)).toEqual(
                resolved[0].face.findSubShapes(ShapeTypes.edge),
            );
        } finally {
            restore();
        }
    });

    test("fails when a referenced profile is gone", () => {
        const { restore } = setup();
        try {
            // The remaining loop has a different edge count, so there is no candidate.
            const triangle = [edge(0, 0, 1, 0), edge(1, 0, 0, 1), edge(0, 1, 0, 0)];
            const ref = captureProfileRef(faceOf(HOLE));
            const result = resolveProfiles(sketchWith(triangle), [ref]);

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Sketch profile not found after rebuild");
        } finally {
            restore();
        }
    });
});

describe("profile topology defects", () => {
    /** A circle edge whose seam (start/end point) sits at `phase` radians from +X. */
    function circleEdgeSeamed(cx: number, cy: number, radius: number, phase: number): IEdge {
        const at = (angle: number) =>
            new XYZ({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), z: 0 });
        return {
            shapeType: ShapeTypes.edge,
            curve: {
                basisCurve: { center: { x: cx, y: cy, z: 0 }, radius, axis: { x: 0, y: 0, z: 1 } },
                nearestFromPoint: (point: XYZ) =>
                    nearestOnCircle(new XYZ({ x: cx, y: cy, z: 0 }), radius, point),
            },
            startPoint: () => at(phase),
            endPoint: () => at(phase),
            firstParameter: () => 0,
            lastParameter: () => Math.PI * 2,
            pointAt: (t: number) => at(phase + t),
            // Concentric circles never intersect; a real kernel would return [] too.
            intersect: () => [],
            boundingBox: () =>
                new BoundingBox(
                    new XYZ({ x: cx - radius, y: cy - radius, z: 0 }),
                    new XYZ({ x: cx + radius, y: cy + radius, z: 0 }),
                ),
        } as unknown as IEdge;
    }

    test("two loops sharing only a vertex stay two distinct profiles", () => {
        const a = square(0, 0, 1, 1);
        const b = square(1, 1, 2, 2);
        const faces = [faceOf(a), faceOf(b)];
        const facesFromEdges = rs.fn((_edges: IEdge[], _plane: Plane) =>
            Result.ok({
                faces,
                sources: [
                    [0, 1, 2, 3],
                    [4, 5, 6, 7],
                ],
            }),
        );
        const restore = mockShapeFactory({ facesFromEdges });
        try {
            // Two squares that touch only at the corner (1,1). They share a vertex, so
            // endpoint connectivity would merge them into one connected group; the branch
            // vertex must instead route them through the kernel, which returns the two
            // loops as separate regions.
            const result = sketchProfiles(sketchWith([...a, ...b]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer).toEqual(faces);
            expect(result.unchecked()!.inner.length).toBe(0);
        } finally {
            restore();
        }
    });

    test("a concentric hole just inside the boundary is not dropped by the chord approximation", () => {
        const { restore } = setup();
        try {
            // The outer circle is sampled as an inscribed 16-gon (apothem ≈ 9.808 at
            // radius 10). The inner circle of radius 9.9 is fully inside the true circle,
            // but its seam is offset by π/16 so one of its samples lands between the
            // 16-gon's vertices at radius 9.9 > 9.808 — the chord approximation flips
            // loopContains to false and turns the hole into a separate solid profile.
            const outer = circleEdgeSeamed(0, 0, 10, 0);
            const inner = circleEdgeSeamed(0, 0, 9.9, Math.PI / 16);
            const result = sketchProfiles(sketchWith([outer, inner]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            expect(result.unchecked()!.inner.length).toBe(1);
        } finally {
            restore();
        }
    });

    test("a profile's seed index is stable when an unrelated loop is appended", () => {
        const { restore } = setup();
        try {
            const a = square(0, 0, 2, 2);
            const b = square(20, 20, 22, 22);
            const c = square(40, 40, 42, 42);

            const refB = captureProfileRef(faceOf(b));
            const before = resolveProfiles(sketchWith([...a, ...b]), [refB]).unchecked()![0].index;

            // Adding an unrelated loop after b keeps b's positional index, which still
            // indexes the profile mesh ranges (see preselectCurrentProfiles).
            const refB2 = captureProfileRef(faceOf(b));
            const after = resolveProfiles(sketchWith([...a, ...b, ...c]), [refB2]).unchecked()![0].index;

            expect(after).toBe(before);
        } finally {
            restore();
        }
    });

    test("a profile's seed comes from its bounding entity ids, not its position", () => {
        const { restore } = setup();
        try {
            const a = square(0, 0, 2, 2);
            const b = square(20, 20, 22, 22);
            const c = square(40, 40, 42, 42);

            const before = resolveProfiles(
                sketchWithIds([...a, ...b], [1, 2, 3, 4, 5, 6, 7, 8]),
            ).unchecked()!;
            expect(before.map((p) => p.seed)).toEqual(["e1.2.3.4", "e5.6.7.8"]);

            // Inserting c ahead of b shifts b's positional index 1 → 2, but the entity
            // ids — and therefore the seed — are unchanged, so downstream edge tracking
            // survives profile reordering.
            const after = resolveProfiles(
                sketchWithIds([...a, ...c, ...b], [1, 2, 3, 4, 9, 10, 11, 12, 5, 6, 7, 8]),
            ).unchecked()!;
            expect(after.map((p) => p.index)).toEqual([0, 1, 2]);
            expect(after.map((p) => p.seed)).toEqual(["e1.2.3.4", "e9.10.11.12", "e5.6.7.8"]);
        } finally {
            restore();
        }
    });

    test("regions bounded by the same entity set get occurrence-suffixed seeds", () => {
        const regions = [faceOf([]), faceOf([])];
        const facesFromEdges = rs.fn((_edges: IEdge[], _plane: Plane) =>
            Result.ok({
                faces: regions,
                sources: [
                    [0, 1],
                    [1, 0],
                ],
            }),
        );
        const restore = mockShapeFactory({ facesFromEdges });
        try {
            // Overlapping squares route through the kernel; both regions report the
            // same bounding entity set (e.g. the lens regions of two crossing circles).
            const edges = [...square(0, 0, 2, 2), ...square(1, 1, 3, 3)];
            const profiles = resolveProfiles(sketchWith(edges)).unchecked()!;

            expect(profiles.map((p) => p.seed)).toEqual(["e1.2", "e1.2~1"]);
        } finally {
            restore();
        }
    });

    test("disjoint loops never call the kernel intersection", () => {
        const intersect = rs.fn((_other: IEdge) => [] as { parameter: number; point: XYZ }[]);
        const circle = (cx: number, radius: number): IEdge => {
            const at = (angle: number) =>
                new XYZ({ x: cx + radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 });
            return {
                shapeType: ShapeTypes.edge,
                curve: {
                    basisCurve: { center: { x: cx, y: 0, z: 0 }, radius, axis: { x: 0, y: 0, z: 1 } },
                    nearestFromPoint: (point: XYZ) =>
                        nearestOnCircle(new XYZ({ x: cx, y: 0, z: 0 }), radius, point),
                },
                startPoint: () => at(0),
                endPoint: () => at(0),
                firstParameter: () => 0,
                lastParameter: () => Math.PI * 2,
                pointAt: (t: number) => at(t),
                intersect,
                boundingBox: () =>
                    new BoundingBox(
                        new XYZ({ x: cx - radius, y: -radius, z: 0 }),
                        new XYZ({ x: cx + radius, y: radius, z: 0 }),
                    ),
            } as unknown as IEdge;
        };
        const { restore } = setup();
        try {
            const result = sketchProfiles(sketchWith([circle(0, 5), circle(30, 5)]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(2);
            // Disjoint bounding boxes are filtered before the kernel intersection runs.
            expect(intersect).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });
});
