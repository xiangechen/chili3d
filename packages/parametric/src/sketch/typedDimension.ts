// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ConstraintKind, type SketchConstraintData } from "./sketchModel";
import type { SketchSolver } from "./solver";
import { centerRef, lineRefs } from "./solverEntities";

/**
 * The two sizes a typed pair asked for, on a shape drawn from two corners — a rectangle, whose
 * width and height the two numbers are (Fusion's and Onshape's rectangle tools read the same two
 * fields the same way).
 *
 * Each is the gap across the shape rather than a distance between the two corners, and that is
 * what makes them survive: rounding a corner moves the corner, so a dimension between two of
 * them would be a reading a corner trim changes. The gap between two parallel edges is one the
 * trim cannot change at all, which is what lets a dimensioned rectangle be filleted.
 *
 * The gap is read the way the Dimension tool reads one (`buildLineGap` in `dimensionInference`),
 * since garlic has no line-to-line distance: the perpendicular distance from an endpoint of one
 * edge across to the other. On parallel edges that is the gap from anywhere along either one.
 *
 * No datum here either, and for the same reason `typedDimension`'s has none: the geometry's own
 * measurement stands in, so neither can fight the sketch it lands on.
 */
export function typedOffsetDimensions(
    width: readonly [fromId: number, acrossId: number],
    height: readonly [fromId: number, acrossId: number],
): Omit<SketchConstraintData, "id">[] {
    return [width, height].map(([fromId, acrossId]) => ({
        kind: ConstraintKind.P2LDistance,
        refs: [lineRefs(fromId)[0], ...lineRefs(acrossId)],
    }));
}

/**
 * The dimension a typed number asked for, on the entity just built — the reading the user
 * stated, rather than the one the drawing hints inferred. It stands where `autoConstraints`
 * does not: a command consults it when a pick was typed as a single number, and the entity is
 * what decides what that number could have meant, since only the entity knows which of its
 * points the pick placed and how big it came out.
 *
 * No datum is written. An absent datum falls back to the geometry's own measurement
 * (`SketchSolver.datumConstraintParams`), which is the number that was typed — the point was
 * placed exactly that far out — and carrying the measurement rather than the stated value is
 * what keeps a dimension placed this way from ever conflicting with the sketch it lands on.
 * The two part only where a drawing hint pulled the point onto something else first, and then
 * the geometry is what the dimension ought to say.
 *
 * Undefined for an entity the typed number is no size of, which the curve families reach two
 * ways. A bezier's or a nurbs' pick places a control pole, and the pole is where the next
 * control point goes rather than any measurement of the curve. A conic's pick places an
 * endpoint, and its lone number is a distance the endpoints could be joined by — but the chord
 * is not a size of the curve, which its control point and rho set between them.
 *
 * Leaving that as the default rather than naming each curve is the point — one added later
 * takes no dimension until someone says which of its measurements a dimension would be.
 */
export function typedDimension(
    solver: SketchSolver,
    entityId: number,
): Omit<SketchConstraintData, "id"> | undefined {
    const type = solver.entity(entityId)?.type;
    if (type === "line") {
        return { kind: ConstraintKind.P2PDistance, refs: lineRefs(entityId) };
    }
    if (type === "circle" || type === "arc") {
        return { kind: ConstraintKind.Radius, refs: [centerRef(entityId)] };
    }
    if (type === "ellipse" || type === "ellipseArc") {
        // center to the major-axis point: the ellipse's own size, which is what its typed
        // number measured there (an ellipse is not a circle, so garlic has no radius for it)
        return { kind: ConstraintKind.P2PDistance, refs: [centerRef(entityId), { entityId, pointIndex: 1 }] };
    }
    return undefined;
}
