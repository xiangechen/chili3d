// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type ISolid, Plane, primaryAncestors, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

// The target: a cylinder along X through (0, 0, 30), r = 10 — its side face spans
// z ∈ [20, 40] over y ∈ [-10, 10]. The profile is a 10×10 rect at x ∈ [5, 15], y ∈ [-5, 5].
function cylinderWithSideFace(center: XYZ = new XYZ(0, 0, 30)): { solid: ISolid; side: IFace } {
    const solid = unwrapOk(factory.cylinder(new XYZ(1, 0, 0), center, 10, 30)) as ISolid;
    const side = (solid.findSubShapes(ShapeTypes.face) as IFace[]).find((f) => !f.surface().isPlanar());
    if (side === undefined) throw new Error("cylinder side face not found");
    return { solid, side };
}

function profileAt(z: number, x = 5): IFace {
    const plane = new Plane({ origin: new XYZ(x, -5, z), normal: XYZ.unitZ, xvec: XYZ.unitX });
    return unwrapOk(factory.rect(plane, 10, 10)) as IFace;
}

function facesOf(shape: ISolid): IFace[] {
    return shape.findSubShapes(ShapeTypes.face) as IFace[];
}

function nonPlanarFaces(shape: ISolid): IFace[] {
    return facesOf(shape).filter((f) => !f.surface().isPlanar());
}

describe("prismToFaceTracked", () => {
    test("standalone: the cap conforms to the cylinder's near side", () => {
        const { side } = cylinderWithSideFace();
        const result = factory.prismToFaceTracked(side, profileAt(0), side, XYZ.unitZ, "new");
        expect(result.isOk).toBe(true);
        if (!result.isOk) return;
        const solid = result.value.shape as ISolid;
        const box = solid.boundingBox();
        expect(box.min.z).toBeCloseTo(0, 6);
        // A planar near-side cap lands at z = 20 exactly; the conforming one follows the
        // surface up to 30 - sqrt(100 - 25) ≈ 21.34 at y = ±5.
        expect(box.max.z).toBeGreaterThan(21.2);
        expect(box.max.z).toBeLessThan(21.5);
        // The cap patch: 10 wide along x over the arc y ∈ [-5, 5] — 100·2·asin(0.5) ≈ 104.72.
        const caps = nonPlanarFaces(solid);
        expect(caps.length).toBe(1);
        expect(caps[0].area()).toBeGreaterThan(103);
        expect(caps[0].area()).toBeLessThan(106.5);
        // History input is [profile, limit]: the bottom derives from the profile (index 0);
        // the cap derives from nothing — a synthetic end, exactly like a plain prism's top
        // (its id is seeded by the caller, not by the kernel's derivation).
        const faces = facesOf(solid);
        const map = primaryAncestors(result.value.faceAncestors, faces.length);
        const bottom = faces.find((f) => f.surface().isPlanar() && f.boundingBox().max.z < 1e-6);
        expect(bottom).not.toBeUndefined();
        expect(map[faces.indexOf(bottom!)]).toBe(0);
        expect(map[faces.indexOf(caps[0])] ?? -1).toBe(-1);
        // The four side faces are generated from the profile's edges.
        const edgeMap = result.value.faceEdgeMap ?? [];
        expect(edgeMap.filter((edge) => edge >= 0).length).toBe(4);
    });

    test("standalone, reversed: from above the cap conforms to the far side", () => {
        const { side } = cylinderWithSideFace();
        const result = factory.prismToFaceTracked(side, profileAt(50), side, XYZ.unitZ.multiply(-1), "new");
        expect(result.isOk).toBe(true);
        if (!result.isOk) return;
        const box = result.value.shape.boundingBox();
        expect(box.max.z).toBeCloseTo(50, 6);
        // From above the sweep meets the far side first: z = 30 + sqrt(100 - 25) ≈ 38.66.
        expect(box.min.z).toBeGreaterThan(38.5);
        expect(box.min.z).toBeLessThan(38.8);
    });

    test("join: the prism fuses into the cylinder with a conforming cap", () => {
        const { solid, side } = cylinderWithSideFace();
        const result = factory.prismToFaceTracked(solid, profileAt(0), side, XYZ.unitZ, "join");
        expect(result.isOk).toBe(true);
        if (!result.isOk) return;
        const fused = result.value.shape as ISolid;
        // Cylinder (π·100·30 ≈ 9424.78) + prism (2000 + ≈43.4 under the surface), tangent at
        // the cap — zero overlap.
        const volume = fused.volume();
        expect(volume).toBeGreaterThan(11300);
        expect(volume).toBeLessThan(11650);
        expect(fused.boundingBox().max.z).toBeLessThan(41);
        // The base's own faces keep their derivation (input indexes 0..2 are the cylinder's
        // faces): the x = 0 end cap among them. Side faces of the prism are edge-generated
        // and the cap is synthetic, so full face coverage is NOT expected.
        const faces = facesOf(fused);
        const map = primaryAncestors(result.value.faceAncestors, faces.length);
        const endCap = faces.find((f) => f.surface().isPlanar() && f.boundingBox().max.x < 1e-6);
        expect(endCap).not.toBeUndefined();
        expect(map[faces.indexOf(endCap!)]).toBeGreaterThanOrEqual(0);
        expect(map[faces.indexOf(endCap!)]).toBeLessThan(3);
        expect(map.filter((ancestor) => ancestor >= 0).length).toBeGreaterThanOrEqual(4);
    });

    test("cut: from inside the body the channel ends on the far side", () => {
        const { solid, side } = cylinderWithSideFace();
        const result = factory.prismToFaceTracked(solid, profileAt(25), side, XYZ.unitZ, "cut");
        expect(result.isOk).toBe(true);
        if (!result.isOk) return;
        const cut = result.value.shape as ISolid;
        // Removed: 10·∫₋₅⁵(30 + sqrt(100 - y²) - 25) dy ≈ 1456.6 → 9424.78 - 1456.6 ≈ 7968.
        const volume = cut.volume();
        expect(volume).toBeGreaterThan(7800);
        expect(volume).toBeLessThan(8100);
        // The channel's end is a piece of the cylinder's side surface.
        expect(nonPlanarFaces(cut).length).toBeGreaterThan(0);
    });

    test("a limit the sweep never meets is a graceful error, not a crash", () => {
        // A cylinder off to the SIDE (y = 1000): the +Z sweep column never crosses it, and no
        // padding can make it — a genuine miss.
        const { side } = cylinderWithSideFace(new XYZ(0, 1000, 30));
        const result = factory.prismToFaceTracked(side, profileAt(0), side, XYZ.unitZ, "new");
        expect(result.isOk).toBe(false);
    });

    test("a limit smaller than the cross-section caps OFF the face — refused", () => {
        // A tiny planar pad right at the near side, covering only part of the sweep column:
        // the padded plane would cap the rest past the pad's boundary.
        const pad = unwrapOk(
            factory.box(
                new Plane({ origin: new XYZ(6, -1, 20), normal: XYZ.unitZ, xvec: XYZ.unitX }),
                2,
                2,
                2,
            ),
        ) as ISolid;
        const top = facesOf(pad).find((f) => f.boundingBox().min.z > 21.9);
        if (top === undefined) throw new Error("pad top face not found");
        const result = factory.prismToFaceTracked(top, profileAt(0), top, XYZ.unitZ, "new");
        expect(result.isOk).toBe(false);
    });

    test("a planar limit at an angle caps with the plane", () => {
        // A box tilted 45° about X, generously large in-plane: the limit is its top face,
        // the plane z = y + 45 + 5·sqrt(2) ≈ y + 52.07.
        const box = unwrapOk(
            factory.box(
                new Plane({ origin: new XYZ(0, -25, 20), normal: new XYZ(0, -1, 1), xvec: XYZ.unitX }),
                30,
                80,
                5,
            ),
        ) as ISolid;
        const tiltNormal = new XYZ(0, -1, 1).normalize()!;
        const top = facesOf(box).find((f) => {
            if (!f.surface().isPlanar()) return false;
            const [, normal] = f.normal(0, 0);
            return normal.dot(tiltNormal) > 0.99;
        });
        if (top === undefined) throw new Error("tilted top face not found");
        const result = factory.prismToFaceTracked(top, profileAt(0), top, XYZ.unitZ, "new");
        expect(result.isOk).toBe(true);
        if (!result.isOk) return;
        const solid = result.value.shape as ISolid;
        // Every cap point lies on the tilted plane: over the profile (y ∈ [-5, 5]) that is
        // z ∈ [47.07, 57.07].
        const box3 = solid.boundingBox();
        expect(box3.min.z).toBeCloseTo(0, 6);
        expect(box3.max.z).toBeGreaterThan(56.5);
        expect(box3.max.z).toBeLessThan(57.6);
    });

    test("a spherical limit is a graceful error, never a module-aborting crash", () => {
        const sphere = unwrapOk(factory.sphere(new XYZ(0, 0, 30), 10)) as ISolid;
        const cap = facesOf(sphere)[0];
        // A floating profile swept at a sphere: no boolean path exists for a spherical limit,
        // and the gluer cannot lift a floating profile — a refusal. Before the padding was
        // restricted to plane/cylinder/cone, padding crossed the sphere's natural V range and
        // the ConstructionError (exceptions disabled in Release) aborted the whole module.
        const result = factory.prismToFaceTracked(cap, profileAt(0), cap, XYZ.unitZ, "new");
        expect(result.isOk).toBe(false);
        // The module survived: a fresh primitive still builds.
        const box = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        expect(factory.box(box, 1, 1, 1).isOk).toBe(true);
    });

    test("join: a prism capped past the limit's own span is refused, not fused as a lump", () => {
        const { solid, side } = cylinderWithSideFace();
        // x ∈ [35, 45] — beyond the cylinder's axial end (x ≤ 30). The padded copy still
        // covers the column, so the prism IS built and capped there; but the only face of the
        // result lying on the real limit is the BASE's own side face, and the added volume
        // satisfies the volume check. Without the new-cap requirement the pair fuses into a
        // disconnected lump that stands off the face.
        const result = factory.prismToFaceTracked(solid, profileAt(0, 35), side, XYZ.unitZ, "join");
        expect(result.isOk).toBe(false);
    });
});
