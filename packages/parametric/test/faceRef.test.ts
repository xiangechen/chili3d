// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, XYZ } from "@chili3d/core";
import { captureFaceFingerprint, completeFaceHistory } from "../src/features/faceRef";

function xyz(x: number, y: number, z: number) {
    return new XYZ({ x, y, z });
}

function planarFace(cx: number, cy: number, cz: number, width: number, height: number, normal = XYZ.unitZ) {
    const half = { x: width / 2, y: height / 2, z: 0 };
    return {
        boundingBox: () => ({
            min: xyz(cx - half.x, cy - half.y, cz),
            max: xyz(cx + half.x, cy + half.y, cz),
        }),
        area: () => width * height,
        surface: () => ({ isPlanar: () => true }),
        normal: () => [xyz(cx, cy, cz), normal],
    } as unknown as IFace;
}

function curvedFace(cx: number, cy: number, cz: number, area: number) {
    return {
        boundingBox: () => ({ min: xyz(cx - 1, cy - 1, cz - 1), max: xyz(cx + 1, cy + 1, cz + 1) }),
        area: () => area,
        surface: () => ({ isPlanar: () => false }),
        normal: () => {
            throw new Error("not planar");
        },
    } as unknown as IFace;
}

describe("captureFaceFingerprint", () => {
    test("captures the bbox center, area and the normal of a planar face", () => {
        const fingerprint = captureFaceFingerprint(planarFace(3, 4, 5, 2, 6));

        expect(fingerprint.center).toEqual({ x: 3, y: 4, z: 5 });
        expect(fingerprint.area).toBe(12);
        expect(fingerprint.normal).toEqual({ x: 0, y: 0, z: 1 });
    });

    test("leaves the normal undefined for a non-planar face", () => {
        const fingerprint = captureFaceFingerprint(curvedFace(0, 0, 0, 8));

        expect(fingerprint.normal).toBeUndefined();
    });
});

describe("completeFaceHistory", () => {
    test("fills an unmapped output with the geometrically identical input", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2), planarFace(9, 9, 9, 2, 2)];
        const outputs = [planarFace(9, 9, 9, 2, 2), planarFace(0, 0, 5, 1, 1)];

        expect(completeFaceHistory(inputs, outputs, [-1, -1])).toEqual([1, -1]);
    });

    test("does not steal an input already claimed by the kernel history", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2)];
        const outputs = [planarFace(0, 0, 0, 2, 2), planarFace(0, 0, 0, 2, 2)];

        expect(completeFaceHistory(inputs, outputs, [0, -1])).toEqual([0, -1]);
    });

    test("does not fill when two unclaimed inputs are identical", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2), planarFace(0, 0, 0, 2, 2)];
        const outputs = [planarFace(0, 0, 0, 2, 2)];

        expect(completeFaceHistory(inputs, outputs, [-1])).toEqual([-1]);
    });

    test("pairs identical outputs with distinct identical inputs", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2), planarFace(0, 0, 0, 2, 2)];
        const outputs = [planarFace(0, 0, 0, 2, 2), planarFace(0, 0, 0, 2, 2)];

        expect(completeFaceHistory(inputs, outputs, [0, -1])).toEqual([0, 1]);
    });

    test("does not fill when the drift exceeds the match tolerance", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2)];
        const outputs = [planarFace(0.01, 0, 0, 2, 2)];

        expect(completeFaceHistory(inputs, outputs, [-1])).toEqual([-1]);
    });

    test("never matches a planar face against a non-planar one", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2)];
        const outputs = [curvedFace(0, 0, 0, 4)];

        expect(completeFaceHistory(inputs, outputs, [-1])).toEqual([-1]);
    });

    test("never matches two planar faces of different orientation", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2, XYZ.unitZ)];
        const outputs = [planarFace(0, 0, 0, 2, 2, XYZ.unitX)];

        expect(completeFaceHistory(inputs, outputs, [-1])).toEqual([-1]);
    });

    test("treats a flipped normal as the same plane", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2, XYZ.unitZ)];
        const outputs = [planarFace(0, 0, 0, 2, 2, XYZ.unitZ.reverse())];

        expect(completeFaceHistory(inputs, outputs, [-1])).toEqual([0]);
    });

    test("skips faces whose kernel queries fail without losing the healthy matches", () => {
        const degenerate = {} as IFace;
        const inputs = [degenerate, planarFace(0, 0, 0, 2, 2)];
        const outputs = [planarFace(0, 0, 0, 2, 2), degenerate];

        expect(completeFaceHistory(inputs, outputs, [-1, -1])).toEqual([1, -1]);
    });

    test("leaves genuinely new faces unmapped", () => {
        const inputs = [planarFace(0, 0, 0, 2, 2)];
        const outputs = [planarFace(0, 0, 0, 4, 4)];

        expect(completeFaceHistory(inputs, outputs, [-1])).toEqual([-1]);
    });
});
