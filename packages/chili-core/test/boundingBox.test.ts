// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type PointLike } from "../src/math/boundingBox";

describe("BoundingBox.isIntersect", () => {
    function box(min: PointLike, max: PointLike) {
        return new BoundingBox(min, max);
    }

    it("returns true for overlapping boxes", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const b = box({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 });
        expect(BoundingBox.isIntersect(a, b)).toBe(true);
        expect(BoundingBox.isIntersect(b, a)).toBe(true);
    });

    it("returns false for non-overlapping boxes", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 });
        expect(BoundingBox.isIntersect(a, b)).toBe(false);
        expect(BoundingBox.isIntersect(b, a)).toBe(false);
    });

    it("returns false for boxes touching at the edge within tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, -0.0001)).toBe(false);
    });

    it("returns false for boxes just outside tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.002, y: 1.002, z: 1.002 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b)).toBe(false);
    });

    it("returns true for boxes just within tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.0005, y: 1.0005, z: 1.0005 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, 0.001)).toBe(true);
    });

    it("works with negative coordinates", () => {
        const a = box({ x: -3, y: -3, z: -3 }, { x: -1, y: -1, z: -1 });
        const b = box({ x: -2, y: -2, z: -2 }, { x: 0, y: 0, z: 0 });
        expect(BoundingBox.isIntersect(a, b)).toBe(true);
    });

    it("returns true for identical boxes", () => {
        const a = box({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, a)).toBe(true);
    });

    it("respects custom tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.01, y: 1.01, z: 1.01 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, 0.02)).toBe(true);
        expect(BoundingBox.isIntersect(a, b, 0.001)).toBe(false);
    });
});
