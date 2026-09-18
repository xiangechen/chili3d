// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, XYZ } from "@chili3d/core";
import { buildTransformMatrix, TRANSFORM_ORDER } from "../src/tools/transformMatrix";

/** Where the matrix sends (1,0,0) — a placement, so a failure reads as geometry, not 16 floats. */
function place(args: Record<string, unknown>, point = new XYZ(1, 0, 0)): number[] {
    const matrix = buildTransformMatrix(args);
    if (typeof matrix === "string") throw new Error(`expected a matrix, got: ${matrix}`);
    const p = matrix.ofPoint(point);
    return [p.x, p.y, p.z].map((v) => {
        const rounded = Math.round(v * 1e6) / 1e6;
        return rounded === 0 ? 0 : rounded;
    });
}

/**
 * These pin the direction of the composition, which is easy to get backwards: `Matrix4.ofPoint`
 * applies a matrix to a point as a ROW vector (`p·M`), so the leftmost factor in the chain is the
 * one that acts first. The array order in `TRANSFORM_STEPS` is therefore the order the arguments
 * reach the geometry, matching what the prompt tells the model.
 */
describe("buildTransformMatrix", () => {
    test("acts on the geometry in TRANSFORM_ORDER", () => {
        expect(TRANSFORM_ORDER).toBe("mirror → scale → rotate → translate");
    });

    test("scales before it translates", () => {
        // scale (2,1,1) first: (1,0,0) -> (2,0,0); then the translation -> (12,0,0).
        // Translating first would put the point at (22,0,0).
        expect(place({ scale: { x: 2, y: 1, z: 1 }, translate: { x: 10, y: 0, z: 0 } })).toEqual([12, 0, 0]);
    });

    test("mirrors before it rotates, so the rotation sees the reflected point", () => {
        // mirror about x=0 first: (1,0,0) -> (-1,0,0); then a quarter turn about Z -> (0,-1,0).
        // Rotating first would give (0,1,0).
        expect(
            place({
                mirror: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
                rotate: { axis: { x: 0, y: 0, z: 1 }, angle: 90 },
            }),
        ).toEqual([0, -1, 0]);
    });

    test("rotates before it translates", () => {
        // rotate first: (1,0,0) -> (0,1,0); then the translation -> (10,1,0).
        expect(
            place({
                rotate: { axis: { x: 0, y: 0, z: 1 }, angle: 90 },
                translate: { x: 10, y: 0, z: 0 },
            }),
        ).toEqual([10, 1, 0]);
    });

    test("rejects an empty transform and names the argument that is invalid", () => {
        expect(buildTransformMatrix({})).toBe("provide at least one of translate, rotate, scale, mirror");
        expect(buildTransformMatrix({ scale: 0 })).toBe("scale must be finite and non-zero");
    });
});
