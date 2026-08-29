// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { rs } from "@rstest/core";
import { sketchFaces } from "../src/features/profileBuilder";
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
    return {
        shapeType: ShapeTypes.edge,
        startPoint: () => new XYZ({ x: x1, y: y1, z: 0 }),
        endPoint: () => new XYZ({ x: x2, y: y2, z: 0 }),
    } as unknown as IEdge;
}

/** Unit square as four connected edges, intentionally unordered. */
function squareEdges(): IEdge[] {
    return [edge(0, 1, 0, 0), edge(1, 0, 1, 1), edge(0, 0, 1, 0), edge(1, 1, 0, 1)];
}

function sketchWith(edges: IEdge[]): SketchNode {
    const compound = {
        shapeType: ShapeTypes.compound,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
    };
    return { shape: Result.ok(compound) } as unknown as SketchNode;
}

function setup(closed = true) {
    const face = { shapeType: ShapeTypes.face };
    const wire = rs.fn((_edges: IEdge[]) =>
        Result.ok({ isClosed: () => closed, toFace: () => Result.ok(face) }),
    );
    const restore = mockShapeFactory({ wire });
    return { wire, face, restore };
}

describe("sketchFaces", () => {
    test("builds one face from an unordered connected loop", () => {
        const { wire, face, restore } = setup();
        try {
            const result = sketchFaces(sketchWith(squareEdges()));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()).toEqual([face]);
            expect(wire).toHaveBeenCalledTimes(1);
            expect((wire.mock.calls[0] as unknown as [IEdge[]])[0].length).toBe(4);
        } finally {
            restore();
        }
    });

    test("splits disjoint loops into separate faces", () => {
        const { wire, restore } = setup();
        try {
            const far = [edge(10, 10, 11, 10), edge(11, 10, 10, 10)];
            const result = sketchFaces(sketchWith([...squareEdges(), ...far]));

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.length).toBe(2);
            expect(wire).toHaveBeenCalledTimes(2);
        } finally {
            restore();
        }
    });

    test("accepts a single closed edge shape directly", () => {
        const { wire, restore } = setup();
        try {
            const circle = edge(0, 0, 0, 0);
            const sketch = { shape: Result.ok(circle) } as unknown as SketchNode;

            const result = sketchFaces(sketch);

            expect(result.isOk).toBe(true);
            expect((wire.mock.calls[0] as unknown as [IEdge[]])[0]).toEqual([circle]);
        } finally {
            restore();
        }
    });

    test("fails on an open profile", () => {
        const { restore } = setup(false);
        try {
            const result = sketchFaces(sketchWith(squareEdges()));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Sketch profile is not closed");
        } finally {
            restore();
        }
    });

    test("fails when the sketch has no entities", () => {
        const { restore } = setup();
        try {
            const result = sketchFaces(sketchWith([]));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Sketch has no entities");
        } finally {
            restore();
        }
    });

    test("propagates wire factory errors", () => {
        const restore = mockShapeFactory({ wire: () => Result.err("wire failed") });
        try {
            const result = sketchFaces(sketchWith(squareEdges()));

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("wire failed");
        } finally {
            restore();
        }
    });
});
