// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IFace,
    type IShape,
    type IVertex,
    Matrix4,
    Plane,
    Precision,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { ResolvedProfile } from "./profileBuilder";

/**
 * The geometry behind a sweep: sweeping faces into prisms (`extrudePlain`, `sweepFaces`,
 * `translateFace`), tapering their sides when the feature carries a draft angle
 * (`taperPrismSides`), and merging the results into one solid (`fuseProfiles`,
 * `combineShapes`, `anyPairTouches`).
 *
 * This is the **plain** path: it builds geometry and reports nothing about ids. The tracked
 * half lives in `sweepTracked.ts` (`sweepFaceTracked`, `fuseSweptPrisms`), reached through
 * `extrude.ts`'s `sweepProfiles` for a profile list — they need the feature's own seeding and
 * the operation-id mappers, which are extrude's business. What is here is what both paths
 * share, and the merge half is also what `commands/extrudeCommand.ts` reuses for its own
 * preview.
 */

/** Sweeps every profile along each direction and merges touching prisms (see `fuseProfiles`). */
export function extrudePlain(
    profiles: ResolvedProfile[],
    vecs: XYZ[],
    offsetVec: XYZ,
    draftAngle?: number,
): Result<IShape> {
    return sweepFaces(
        profiles.map(({ face }) => face),
        () => vecs,
        () => offsetVec,
        draftAngle,
    );
}

/**
 * Sweeps each face along its own vectors (`vecsOf`) and merges touching prisms. A non-zero
 * `draftAngle` (degrees) tapers each prism's side faces about its start plane right after the
 * sweep — before the merge — exactly as the tracked path does (`extrudeDraft.ts`).
 */
export function sweepFaces(
    faces: IFace[],
    vecsOf: (face: IFace) => XYZ[],
    offsetOf: (face: IFace) => XYZ,
    draftAngle?: number,
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
                if (draftAngle === undefined || draftAngle === 0) {
                    shapes.push(shape.value);
                    continue;
                }
                // Read the start plane only when drafting — a mock face (unit tests) has
                // no `normal`, and the straight path must not touch it.
                const [basePoint, baseNormal] = sweptFace.normal(0, 0);
                const tapered = taperPrismSides(shape.value, basePoint, baseNormal, vec, draftAngle);
                if (!tapered.isOk) {
                    shape.value.dispose();
                    shapes.forEach((x) => x.dispose());
                    return Result.err(tapered.error);
                }
                shapes.push(tapered.value);
            }
        }
    } finally {
        owned.forEach((x) => x.dispose());
    }
    return fuseProfiles(shapes);
}

/**
 * Tapers a freshly swept prism's side faces about its start plane by `angle` DEGREES — the
 * plain counterpart of the tracked taper (`taperSweptPrism` in extrudeDraft.ts), building the
 * same geometry with no ids. `basePoint`/`baseNormal` give the start plane (the profile face's
 * plane after the start offset), `vec` the sweep vector: its direction is the pull direction,
 * so a positive angle narrows the prism toward its end.
 */
export function taperPrismSides(
    shape: IShape,
    basePoint: XYZ,
    baseNormal: XYZ,
    vec: XYZ,
    angle: number,
): Result<IShape> {
    const sides = prismSideFaces(shape, basePoint, baseNormal, vec);
    // A prism with no identifiable sides has nothing to taper — returning it unchanged keeps
    // a degenerate-but-answered sweep from failing the feature.
    if (sides.length === 0) return Result.ok(shape);
    const pull = vec.normalize();
    if (pull === undefined) return Result.err("Extrude draft requires a non-zero sweep direction");
    const plane = new Plane({
        origin: basePoint,
        normal: pull,
        xvec: Math.abs(pull.z) > 0.9 ? XYZ.unitX : XYZ.unitZ,
    });
    const tapered = shapeFactory.draft(shape, sides, pull, angle, plane);
    if (!tapered.isOk) return Result.err(tapered.error);
    shape.dispose();
    return Result.ok(tapered.value);
}

/**
 * The side faces of a prism swept from a planar profile, picked geometrically: a cap is a
 * TRANSLATE of the profile face, so every vertex of a cap lies on one of the two planes
 * parallel to the profile through the prism's ends (`vec`'s normal component is the caps'
 * separation — an oblique sweep direction shifts the top cap sideways, not off the rule);
 * a side face spans both planes.
 */
export function prismSideFaces(shape: IShape, basePoint: XYZ, baseNormal: XYZ, vec: XYZ): IFace[] {
    const top = vec.dot(baseNormal);
    const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.filter((face) => {
        const distances = (face.findSubShapes(ShapeTypes.vertex) as IVertex[]).map((vertex) =>
            vertex.point().sub(basePoint).dot(baseNormal),
        );
        const onBase = distances.every((d) => Math.abs(d) < Precision.Distance);
        const onTop = distances.every((d) => Math.abs(d - top) < Precision.Distance);
        return !onBase && !onTop;
    });
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
