// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IShape, Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createBox, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

const facesOf = (shape: IShape): IFace[] => shape.findSubShapes(ShapeTypes.face) as IFace[];

/** Input indexes recorded for `outputIndex` in the flat (out, in) ancestor pairs. */
function ancestorsOf(ancestors: number[] | undefined, outputIndex: number): number[] {
    const inputs: number[] = [];
    for (let i = 0; ancestors !== undefined && i + 1 < ancestors.length; i += 2) {
        if (ancestors[i] === outputIndex) inputs.push(ancestors[i + 1]);
    }
    return [...new Set(inputs)].sort((a, b) => a - b);
}

/**
 * Box 40×40×20 (corner-based: x,y∈[0,40], z∈[0,20]) with a boss (20×10×8) fused onto
 * its front side (y = 0) so the boss top is coplanar with the box top: the fuse
 * unifies them into one T-shaped face. The kernel history input enumerates the arg
 * body's faces first, then the tool's.
 */
function fuseWithMergedTop() {
    const box = createBox(factory, 40, 40, 20);
    const boss = unwrapOk(factory.box(Plane.XY, 20, 10, 8));
    const placed = boss.transformed(Matrix4.fromTranslation(15, -10, 12));
    const result = factory.booleanFuseTracked([box], [placed]);
    expect(result.isOk).toBe(true);
    const input = unwrapOk(factory.combine([box, placed]));
    return { result: result.value, inputFaces: facesOf(input) };
}

describe("ShapeFactory — multi-valued boolean history", () => {
    test("a face merged from two input faces records both ancestors", () => {
        const { result, inputFaces } = fuseWithMergedTop();
        const outFaces = facesOf(result.shape);
        const mergedIndex = outFaces.findIndex(
            (face) => face.normal(0, 0)[1].z > 1 - 1e-6 && face.area() > 1600,
        );
        expect(mergedIndex).toBeGreaterThanOrEqual(0);

        // The single-valued map keeps the first ancestor; the pairs keep both — one
        // from the arg body (index < 6), one from the tool (index >= 6).
        const inputs = ancestorsOf(result.faceAncestors, mergedIndex);
        expect(result.faceMap[mergedIndex]).toBe(inputs[0]);
        expect(inputs.length).toBe(2);
        expect(inputs[0]).toBeLessThan(6);
        expect(inputs[1]).toBeGreaterThanOrEqual(6);
        // Both ancestors are the two top faces of the input bodies.
        for (const inputIndex of inputs) {
            expect(inputFaces[inputIndex].normal(0, 0)[1].z).toBeGreaterThan(1 - 1e-6);
        }
    });

    test("an absorbed face records no ancestor pair (deleted, not merged)", () => {
        const { result, inputFaces } = fuseWithMergedTop();
        // The boss back face (y = 0, outward normal +y toward the box) ends up inside
        // the fused solid — genuinely deleted, so no output claims it. This is the
        // signal that keeps merge aliases from being poisoned by absorbed faces.
        const bossBackIndex = inputFaces.findIndex(
            (face) => face.normal(0, 0)[1].y > 1 - 1e-6 && face.area() < 200,
        );
        expect(bossBackIndex).toBeGreaterThanOrEqual(6);
        const claimed = new Set<number>();
        for (let i = 0; result.faceAncestors !== undefined && i + 1 < result.faceAncestors.length; i += 2) {
            claimed.add(result.faceAncestors[i + 1]);
        }
        expect(result.faceAncestors).toBeDefined();
        expect(claimed.has(bossBackIndex)).toBe(false);
    });

    test("faceMap stays single-valued and aligned with the output faces", () => {
        const { result } = fuseWithMergedTop();
        expect(result.faceMap.length).toBe(facesOf(result.shape).length);
        // Every ancestor pair points at a valid output/input index.
        for (let i = 0; result.faceAncestors !== undefined && i + 1 < result.faceAncestors.length; i += 2) {
            expect(result.faceAncestors[i]).toBeGreaterThanOrEqual(0);
            expect(result.faceAncestors[i]).toBeLessThan(result.faceMap.length);
            expect(result.faceAncestors[i + 1]).toBeGreaterThanOrEqual(0);
        }
    });

    test("an edge merged from two collinear edges records both ancestors", () => {
        // Two boxes adjacent along x with identical y/z extents: the fuse unifies the
        // shared side and merges each pair of collinear contiguous edges into one.
        const box = createBox(factory, 40, 20, 10);
        const next = unwrapOk(factory.box(Plane.XY, 20, 20, 10)).transformed(
            Matrix4.fromTranslation(40, 0, 0),
        );
        const result = factory.booleanFuseTracked([box], [next]);
        expect(result.isOk).toBe(true);

        const edges = result.value.shape.findSubShapes(ShapeTypes.edge) as IEdge[];
        const mergedIndex = edges.findIndex((edge) => Math.abs(edge.length() - 60) < 1e-6);
        expect(mergedIndex).toBeGreaterThanOrEqual(0);

        // Each body contributes 12 input edges, args first: one ancestor from each.
        const inputs = ancestorsOf(result.value.edgeAncestors, mergedIndex);
        expect(inputs.length).toBe(2);
        expect(inputs[0]).toBeLessThan(12);
        expect(inputs[1]).toBeGreaterThanOrEqual(12);
    });
});
