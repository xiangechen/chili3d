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
    } as unknown as IEdge;
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
    } as unknown as IFace;
}

/** wire() keeps its edges; face() exposes the boundary edges of all its wires. */
function setup(closed = true) {
    const wire = rs.fn((edges: IEdge[]) => Result.ok({ isClosed: () => closed, edges }));
    const face = rs.fn((wires: { edges: IEdge[] }[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            wires,
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
