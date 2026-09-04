// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, Plane, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
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
        curve: { basisCurve: { direction: { x: x2 - x1, y: y2 - y1, z: 0 } } },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: (other: IEdge) => segmentIntersect(start, end, other.startPoint(), other.endPoint()),
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
    const compound = {
        shapeType: ShapeTypes.compound,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
    };
    return { shape: Result.ok(compound), plane: Plane.XY } as unknown as SketchNode;
}

function faceOf(edges: IEdge[]): IFace {
    return {
        shapeType: ShapeTypes.face,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        outerWire: () => ({
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
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
            const sketch = { shape: Result.ok(circle), plane: Plane.XY } as unknown as SketchNode;

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
            typeof faces === "string" ? Result.err(faces) : Result.ok(faces),
        );
        const restore = mockShapeFactory({ wire, face, facesFromEdges });
        return { wire, facesFromEdges, restore };
    }

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
            curve: { basisCurve: { center: { x: cx, y: cy, z: 0 }, radius, axis: { x: 0, y: 0, z: 1 } } },
            startPoint: () => new XYZ({ x: cx + radius, y: cy, z: 0 }),
            endPoint: () => new XYZ({ x: cx + radius, y: cy, z: 0 }),
            firstParameter: () => 0,
            lastParameter: () => Math.PI * 2,
            pointAt: (t: number) =>
                new XYZ({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t), z: 0 }),
            // The test circles never intersect anything; a real kernel would return [] too.
            intersect: () => [],
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
