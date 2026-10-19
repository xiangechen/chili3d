// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type I18nKeys,
    type IDocument,
    Precision,
    type VisualShapeData,
    type XYZ,
    type XYZLike,
} from "@chili3d/core";
import { candidateBodies } from "./booleanTargets";

/**
 * What pushing or pulling a sketch profile does to the bodies around it. "new" stands the
 * prism up as a body of its own — the plain Extrude a sketch always was.
 */
export type SketchPressPullOperation = "cut" | "join" | "new";

/** The Extrude operation dropdown value each outcome picks. */
export const SKETCH_OPERATIONS: Record<SketchPressPullOperation, I18nKeys> = {
    cut: "option.command.operation.cut",
    join: "option.command.operation.join",
    new: "option.command.operation.new",
};

/**
 * The operation a sketch profile's push-pull carries, decided by where the drag ENDS —
 * the arrow's origin walked `distance` along its own axis (which is the extruded prism's
 * sweep too, so a drag INTO the material reads as the cut it looks like):
 *
 * - the end inside a body → cut;
 * - the end outside every body, but the swept prism still meets one → join;
 * - the prism meeting none → new body.
 *
 * The end is classified against the solid rather than its box (`containsPoint` is the
 * kernel's own reading, in the body's local space). The prism-meets-body test IS box-based,
 * over EVERY picked profile's box — pushing two disjoint profiles together must not read as
 * "meets nothing" just because the first one misses — and against the same candidate set the
 * classification already walked, so the model tree is searched once per call.
 *
 * A body that only looks close joins nothing and the boolean is a no-op, exactly as running
 * Extrude on it by hand would be.
 */
export function sketchPressPullOperation(
    document: IDocument,
    picked: readonly VisualShapeData[],
    origin: XYZ,
    direction: XYZ,
    distance: number,
): SketchPressPullOperation {
    const end = origin.add(direction.multiply(distance));
    // One walk of the model tree; each body's placement, shape and world box are read once and
    // shared by both readings below.
    const bodies = candidateBodies(document)
        .filter((body) => body.shape.isOk)
        .map((body) => {
            const world = body.worldTransform();
            const shape = body.shape.value;
            return {
                shape,
                inverse: world.invert(),
                box: BoundingBox.transformed(shape.boundingBox(), world),
            };
        });
    // The box test is the cheap early-out: `containsPoint` crosses into WASM and is asked only of
    // a body whose box already holds the end, which on a drag is almost never more than one.
    if (
        bodies.some(
            ({ shape, inverse, box }) =>
                inverse !== undefined &&
                BoundingBox.isInside(box, end) &&
                shape.containsPoint(inverse.ofPoint(end), false, Precision.Distance),
        )
    ) {
        return "cut";
    }

    const prism = sweptBox(picked, direction, distance);
    if (prism !== undefined && bodies.some(({ box }) => BoundingBox.isIntersect(prism, box))) {
        return "join";
    }
    return "new";
}

/**
 * The prism a drag would sweep, as a world-space box: every picked profile's box moved to
 * world space and merged, then stretched along the drag so a negative distance grows it
 * backwards. Undefined when no profile box is usable.
 */
function sweptBox(
    picked: readonly VisualShapeData[],
    direction: XYZ,
    distance: number,
): BoundingBox | undefined {
    const boxes = picked
        .map((pick) => ({ box: pick.shape.boundingBox(), transform: pick.transform }))
        .filter(({ box }) => BoundingBox.isValid(box))
        .map(({ box, transform }) => BoundingBox.transformed(box, transform));
    if (boxes.length === 0) return undefined;

    const extent = BoundingBox.fromPoints(boxes.flatMap((box) => [box.min, box.max]));
    const offset = direction.multiply(distance);
    return BoundingBox.fromPoints([
        extent.min,
        extent.max,
        offsetPoint(extent.min, offset),
        offsetPoint(extent.max, offset),
    ]);
}

function offsetPoint(point: XYZLike, offset: XYZ): XYZLike {
    return { x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z };
}
