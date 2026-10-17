// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { sweepFaces } from "../src/features/sweepGeometry";

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: methods,
        writable: true,
        configurable: true,
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

describe("sweepFaces", () => {
    test("frees every prism when the merge fails", () => {
        const disposeA = rs.fn();
        const disposeB = rs.fn();
        // Disjoint boxes keep `fuseProfiles` on the plain compound path, which is the one
        // whose failure used to drop the swept prisms on the floor.
        const prisms = [
            {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: disposeA,
                findSubShapes: () => [],
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
            },
            {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: disposeB,
                findSubShapes: () => [],
                boundingBox: () => new BoundingBox({ x: 10, y: 0, z: 0 }, { x: 11, y: 1, z: 1 }),
            },
        ];
        let next = 0;
        const restore = mockShapeFactory({
            prism: () => Result.ok(prisms[next++]),
            combine: () => Result.err("combine failed"),
            booleanFuse: () => Result.err("fuse failed"),
        });
        try {
            const face = {
                shapeType: ShapeTypes.face,
                dispose: () => {},
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }),
            } as any;

            // Two sweep vectors make two prisms, so the merge has something to combine.
            const vec = new XYZ({ x: 0, y: 0, z: 1 });
            const merged = sweepFaces(
                [face],
                () => [vec, vec],
                () => XYZ.zero,
            );

            expect(merged.isOk).toBe(false);
            expect(disposeA).toHaveBeenCalledTimes(1);
            expect(disposeB).toHaveBeenCalledTimes(1);
        } finally {
            restore();
        }
    });
});
