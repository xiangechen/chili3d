// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger, Result } from "../foundation";
import type { XYZ } from "../math";
import type { IEdge, IFace, IWire } from "../shape";
import { type ContourGroup, flattenContour, groupContours } from "./contourRegions";
import type { Contour2D, Vec2 } from "./fontOutline";

/** Where a contour's points land in the world. Takes points in font units. */
export type ToWorld = (point: Vec2) => XYZ;

export interface OutlineShapeOptions {
    toWorld: ToWorld;
    /** A contour bounding less than this in the world bounds no face worth having. */
    minContourSize: number;
}

/**
 * Build the faces of one glyph's outline: one face per filled region, with the
 * loops nested inside it cut out as holes.
 *
 * The outer array is one entry per solid the glyph makes. A glyph states an
 * overlapping stroke as a region of its own — that is how a fill rule reads them —
 * and the regions that overlap belong to the one solid, so they are handed back
 * together for the caller to fuse. Everything else is a piece on its own.
 *
 * Nothing here trusts the font. Contours that bound nothing usable are dropped,
 * and a region whose wires the kernel will not chain is skipped rather than
 * forced — a single malformed glyph must not cost the user their whole text, and
 * an OCCT failure in a release build aborts the module rather than throwing.
 */
export function glyphFaces(contours: readonly Contour2D[], options: OutlineShapeOptions): IFace[][] {
    const usable = distinctContours(contours).filter(
        (contour) => contourSize(contour, options.toWorld) >= options.minContourSize,
    );

    const pieces: IFace[][] = [];
    for (const piece of groupContours(usable)) {
        const faces = piece
            .map((group) => regionFace(group, usable, options.toWorld))
            .filter((face) => face !== undefined);
        if (faces.length > 0) pieces.push(faces);
    }

    return pieces;
}

/** One region's face: the loop around it, with the loops inside it cut out as holes. */
function regionFace(
    group: ContourGroup,
    contours: readonly Contour2D[],
    toWorld: ToWorld,
): IFace | undefined {
    const outer = wireOf(contours[group.outer], toWorld);
    if (outer === undefined) return undefined;

    const holes: IWire[] = [];
    for (const index of group.holes) {
        const hole = wireOf(contours[index], toWorld);
        if (hole === undefined) {
            // A missing hole would leave the region filled where it has to be open, which is
            // worse than not drawing the region at all.
            Logger.warn("Skipped a text glyph region whose hole would not chain");
            return undefined;
        }
        holes.push(hole);
    }

    const face = shapeFactory.face([outer, ...holes]);
    if (!face.isOk) {
        Logger.warn(`Skipped a text glyph region: ${face.error}`);
        return undefined;
    }
    return face.value;
}

function wireOf(contour: Contour2D, toWorld: ToWorld) {
    const edges = contourEdges(contour, toWorld);
    if (!edges.isOk) {
        Logger.warn(`Skipped a text glyph contour: ${edges.error}`);
        return undefined;
    }

    const wire = shapeFactory.wire(edges.value);
    if (!wire.isOk) {
        Logger.warn(`Skipped a text glyph contour: ${wire.error}`);
        return undefined;
    }
    return wire.value;
}

/** Edges chaining the contour's points, a straight one per line and a curve per curve. */
function contourEdges(contour: Contour2D, toWorld: ToWorld): Result<IEdge[]> {
    if (contour.segments.length === 0) return Result.err("the contour has no segments");

    const edges: IEdge[] = [];
    // Each point is mapped once and shared with the segment before it: `wire`
    // chains edges only to within its own tolerance, so a point mapped twice
    // could leave the loop unclosed.
    let from = toWorld(contour.start);

    for (const segment of contour.segments) {
        const to = toWorld(segment.to);
        const edge =
            segment.kind === "line"
                ? shapeFactory.line(from, to)
                : segment.kind === "quad"
                  ? shapeFactory.bezier([from, toWorld(segment.c1), to])
                  : shapeFactory.bezier([from, toWorld(segment.c1), toWorld(segment.c2), to]);
        if (!edge.isOk) return Result.err(edge.error);

        edges.push(edge.value);
        from = to;
    }

    return Result.ok(edges);
}

/** The diagonal of a contour's bounding box, measured where it will be drawn. */
function contourSize(contour: Contour2D, toWorld: ToWorld): number {
    const points = flattenContour(contour).map(toWorld);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const zs = points.map((point) => point.z);

    return Math.hypot(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
        Math.max(...zs) - Math.min(...zs),
    );
}

/** Drops contours repeated verbatim, which would otherwise nest inside each other. */
function distinctContours(contours: readonly Contour2D[]): Contour2D[] {
    const seen = new Set<string>();
    return contours.filter((contour) => {
        const key = flattenContour(contour)
            .map((point) => `${point.x},${point.y}`)
            .join(";");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
