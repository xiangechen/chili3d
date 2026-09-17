// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IFace, type IShape, Matrix4, Precision, Result, type XYZ } from "@chili3d/core";
import type { ResolvedProfile } from "./profileBuilder";

/**
 * Sweeping faces into prisms and merging the ones that touch.
 *
 * This is the **plain** path: it builds geometry and reports nothing about ids. Its
 * tracked counterparts — `sweepProfiles`, `sweepProfileTracked`, `fuseSweptPrisms` —
 * stay in `extrude.ts`, because they need the feature's own seeding and the
 * operation-id mappers, which are extrude's business. What is here is what both paths
 * share and what `commands/extrudeCommand.ts` reuses for its own preview.
 */

/** Sweeps every profile along each direction and merges touching prisms (see `fuseProfiles`). */
export function extrudePlain(profiles: ResolvedProfile[], vecs: XYZ[], offsetVec: XYZ): Result<IShape> {
    return sweepFaces(
        profiles.map(({ face }) => face),
        () => vecs,
        () => offsetVec,
    );
}

/** Sweeps each face along its own vectors (`vecsOf`) and merges touching prisms. */
export function sweepFaces(
    faces: IFace[],
    vecsOf: (face: IFace) => XYZ[],
    offsetOf: (face: IFace) => XYZ,
): Result<IShape> {
    const shapes: IShape[] = [];
    const owned: IFace[] = [];
    try {
        for (const face of faces) {
            const sweptFace = translateFace(face, offsetOf(face), owned);
            for (const vec of vecsOf(face)) {
                const shape = shapeFactory.prism(sweptFace, vec);
                if (!shape.isOk) {
                    shapes.forEach((x) => x.dispose());
                    return Result.err(shape.error);
                }
                shapes.push(shape.value);
            }
        }
    } finally {
        owned.forEach((x) => x.dispose());
    }
    return fuseProfiles(shapes);
}

/**
 * Translates `face` along `vec` to apply a start offset; a near-zero offset returns
 * the face unchanged. Translated copies are pushed to `owned` for the caller to
 * dispose after the kernel has read them eagerly.
 */
export function translateFace(face: IFace, vec: XYZ, owned: IFace[]): IFace {
    if (vec.length() < Precision.Float) return face;
    const translated = face.transformedMul(Matrix4.fromTranslation(vec.x, vec.y, vec.z)) as IFace;
    owned.push(translated);
    return translated;
}

/**
 * Merges per-profile prisms into a single solid when they touch — `booleanFuse`
 * keeps disjoint solids separate, so disjoint profiles degrade to a compound. The
 * bounding-box precheck skips the boolean (the most expensive step of a rebuild)
 * when no pair can possibly touch; a failed fuse falls back to the plain compound.
 */
export function fuseProfiles(shapes: IShape[]): Result<IShape> {
    if (shapes.length > 1 && anyPairTouches(shapes)) {
        const fused = shapeFactory.booleanFuse([shapes[0]], shapes.slice(1), true);
        if (fused.isOk) {
            shapes.forEach((x) => x.dispose());
            return Result.ok(fused.value);
        }
    }
    return combineShapes(shapes);
}

export function combineShapes(shapes: IShape[]): Result<IShape> {
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

export function anyPairTouches(shapes: IShape[]): boolean {
    const boxes = shapes.map((x) => x.boundingBox());
    return boxes.some((box, i) => boxes.slice(i + 1).some((other) => BoundingBox.isIntersect(box, other)));
}
