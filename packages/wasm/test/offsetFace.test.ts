// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IFace,
    type IShape,
    type OffsetFaceProblem,
    Plane,
    primaryAncestors,
    type Result,
    ShapeTypes,
    type TrackedShape,
    XYZ,
} from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

/**
 * The flat face of `shape` facing `direction` — for a box, the one on that side.
 *
 * Planar only, and that is load-bearing: `normal()` hands back an UNNORMALIZED vector on a curved
 * face (a fillet's round answers `(3, 0, 0)` for a dot of 3), so without this a search for "the
 * face pointing at +x" would happily return a round standing at that corner.
 */
function facing(shape: IShape, direction: XYZ): IFace {
    const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
    const face = faces.find((x) => x.surface().isPlanar() && x.normal(0, 0)[1].dot(direction) > 0.99);
    if (face === undefined) throw new Error("no flat face faces that way");
    return face;
}

/** The tracked offset entry the feature calls, with the kernel's classified failure. */
function offsetFaces(shape: IShape, faces: IFace[], distance: number, rounds: IFace[] = []) {
    const offset = factory.offsetFacesTracked;
    if (offset === undefined) throw new Error("the kernel has no offsetFacesTracked");
    return offset(shape, faces, distance, rounds);
}

/** `unwrapOk` for this op: its error is a classification, not a string. */
function unwrapOffset(result: Result<TrackedShape, OffsetFaceProblem>): TrackedShape {
    if (!result.isOk) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
    return result.value;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const box = (dx = 20, dy = 30, dz = 10) => unwrapOk(factory.box(Plane.XY, dx, dy, dz));

describe("ShapeFactory — offset face", () => {
    test("moves a face out, its neighbours following", () => {
        const solid = box();
        const moved = unwrapOffset(offsetFaces(solid, [facing(solid, XYZ.unitZ)], 5));

        // The top face rises by 5 and the four side faces extend to meet it: 20 × 30 × 15.
        expect(round(moved.shape.volume())).toBe(20 * 30 * 15);
    });

    test("moves a face in", () => {
        const solid = box();
        const moved = unwrapOffset(offsetFaces(solid, [facing(solid, XYZ.unitZ)], -4));

        expect(round(moved.shape.volume())).toBe(20 * 30 * 6);
    });

    test("reports every result face as derived from the face it was", () => {
        const solid = box();
        const moved = unwrapOffset(offsetFaces(solid, [facing(solid, XYZ.unitZ)], 5));

        const count = moved.shape.findSubShapes(ShapeTypes.face).length;
        const ancestors = primaryAncestors(moved.faceAncestors, count);
        // Each of the six faces derives from an input face — which is what lets a moved face keep
        // its id, and a reference to a face beside it keep resolving (`trackedFaceIds`).
        expect(ancestors.every((input) => input >= 0)).toBe(true);
    });

    test("changes a cylinder wall's radius", () => {
        const cylinder = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 10, 20));
        const wall = cylinder
            .findSubShapes(ShapeTypes.face)
            .filter((f) => !(f as IFace).surface().isPlanar()) as IFace[];
        const moved = unwrapOffset(offsetFaces(cylinder, wall, 2));

        // r = 10 → 12 over a height of 20.
        expect(round(moved.shape.volume())).toBeCloseTo(round(Math.PI * 12 * 12 * 20), 0);
    });

    test("refuses a distance of 0", () => {
        const solid = box();
        const result = offsetFaces(solid, [facing(solid, XYZ.unitZ)], 0);

        expect(result.isOk).toBe(false);
    });

    test("refuses a body that is not a solid", () => {
        const solid = box();
        const face = facing(solid, XYZ.unitZ);
        const result = offsetFaces(face, [face], 5);

        expect(result.isOk).toBe(false);
        expect(result.isOk ? 0 : result.error.status).toBe(3);
    });

    test("classifies a distance too far for the body, and finds how far it goes", () => {
        const solid = box(20, 30, 10);
        // Pushed far enough through the body that the "it must shrink" test fails.
        const result = offsetFaces(solid, [facing(solid, XYZ.unitZ)], -50);

        expect(result.isOk).toBe(false);
        expect(result.isOk ? 0 : result.error.status).toBe(1);
        // The bisection lands just under the body's height.
        expect(result.isOk ? 0 : result.error.maxDistance).toBeGreaterThan(8);
        expect(result.isOk ? 0 : result.error.maxDistance).toBeLessThanOrEqual(10);
    });

    test("keeps a round's radius beside a moved wall, and carries it with the wall without", () => {
        const block = box(40, 30, 20);
        // The four vertical edges rounded, so the +x face has a round at each end of it.
        const edges = block.findSubShapes(ShapeTypes.edge);
        const vertical = edges
            .map((_, index) => index)
            .filter((index) => edges[index].boundingBox().max.z - edges[index].boundingBox().min.z > 10);
        const rounded = unwrapOk(factory.fillet(block, vertical, 3));
        const wall = facing(rounded, XYZ.unitX);
        // The rounds are the body's only curved faces: a quarter-cylinder 3 mm across, 20 mm tall.
        const rounds = (rounded.findSubShapes(ShapeTypes.face) as IFace[]).filter(
            (face) => !face.surface().isPlanar() && round(face.area()) === round((Math.PI * 3 * 20) / 2),
        );
        expect(rounds).toHaveLength(4);

        const kept = unwrapOffset(offsetFaces(rounded, [wall], 4, rounds));
        const carried = unwrapOffset(offsetFaces(rounded, [wall], 4));

        // Kept: the rounds stay 3 mm and only their axes follow the wall, so the block grows in x
        // and the faces across from it do not move.
        expect(kept.shape.boundingBox().min.y).toBeCloseTo(0, 3);
        expect(kept.shape.boundingBox().max.y).toBeCloseTo(30, 3);
        // Carried: OCCT offsets a round with the face it runs into, so it comes back wider (3 → 7)
        // and pushes the front and back faces out by the same 4 mm.
        expect(carried.shape.boundingBox().min.y).toBeCloseTo(-4, 3);
    });

    test("refuses a body whose rounded edges meet at a sharp corner", () => {
        const solid = box(20, 30, 10);
        // The four top edges rounded, the vertical ones left sharp: one smooth chain with a crease
        // inside it, which traps OCCT's offset whichever face is moved.
        // The bounding boxes carry OCCT's tolerance (about 0.025 here), so "on the top" is a range,
        // not an equality.
        const edges = solid.findSubShapes(ShapeTypes.edge);
        const topEdges = edges
            .map((_, index) => index)
            .filter((index) => edges[index].boundingBox().min.z > 5);
        const rounded = unwrapOk(factory.fillet(solid, topEdges, 3));

        const result = offsetFaces(rounded, [facing(rounded, XYZ.unitZ)], 2);

        expect(result.isOk).toBe(false);
        expect(result.isOk ? 0 : result.error.status).toBe(6);
    });
});
