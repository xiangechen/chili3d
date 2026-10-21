// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Contour2D,
    type IBezierCurve,
    type ICurve,
    type IEdge,
    type IFace,
    type ITrimmedCurve,
    type IWire,
    Logger,
    Precision,
    type Segment2D,
    ShapeTypes,
    type Vec2,
    type XYZ,
} from "@chili3d/core";

/**
 * The kernel half of a merged text layout: a glyph's region faces fused piece by piece
 * (`fuseGlyphPieces`), and the fused boundary wires read back into the `Contour2D`s a text
 * entity stores (`fusedGlyphContours`).
 *
 * A font states a glyph as one closed contour per STROKE, and a CJK glyph's strokes cross
 * (`十`, `国`): kept raw, the crossings are sketch geometry of their own and the even-odd
 * profile rule punches the overlap out as holes. The union is the kernel's to take — the
 * same fuse `textSolid` runs — and this module is where the fused faces become contours
 * again. The faces are built in anchor-relative millimetres on z = 0 (the layout's
 * `toWorld` is the identity there), so a point reads back as (x, y) and the z only ever
 * says ~0. This is the text's LOCAL frame — unrotated, the baseline along +x; the entity's
 * rotation is a param of its own (`params[2]`) that the readers apply, so a turn never
 * re-lays or re-fuses anything.
 *
 * Nothing here is trusted: a wire that will not chain or a curve that will not read is
 * skipped with a warning, never thrown through — one malformed glyph must not cost the
 * line, and an OCCT raise in the WASM build aborts the whole module rather than throwing.
 */

/** Chord error the sampled fallback stays within, and the most segments one edge may take. */
const SAMPLE_TOLERANCE = Precision.Distance;
const SAMPLE_CAP = 256;

/**
 * One glyph's faces with the strokes merged: the faces of a piece overlap — that is what
 * made them one piece (`groupContours`) — so they are fused into the glyph's outline
 * there. The bare fuse hands the union back as coplanar faces split along the strokes'
 * crossing edges, and each one's boundary wire would read back as a contour of its own —
 * the seams would be sketch geometry again. So the faces are unified — FACES only, never
 * edges: unifying same-domain edges is what rebuilds a curve piece as a bspline, and the
 * readback keeps the curves the font stated.
 *
 * A piece the kernel will not fuse keeps its faces as they are, and one whose faces will
 * not unify keeps the fused partition: the outline then carries stroke seams — exactly
 * what the unmerged layout draws — which beats losing the glyph over it.
 */
export function fuseGlyphPieces(pieces: readonly IFace[][]): IFace[] {
    const faces: IFace[] = [];
    for (const piece of pieces) {
        if (piece.length === 1) {
            faces.push(piece[0]);
            continue;
        }
        const fused = shapeFactory.booleanFuse([piece[0]], piece.slice(1), false);
        if (!fused.isOk) {
            Logger.warn(`A text glyph's regions would not fuse: ${fused.error}`);
            faces.push(...piece);
            continue;
        }
        const unified = shapeFactory.simplifyShape(fused.value, false, true, []);
        if (!unified.isOk) {
            Logger.warn(`A text glyph's fused regions would not unify: ${unified.error}`);
        }
        faces.push(
            ...((unified.isOk ? unified.value : fused.value).findSubShapes(ShapeTypes.face) as IFace[]),
        );
    }
    return faces;
}

/** The faces' boundary wires as stored contours — one contour per wire, outer and holes alike. */
export function fusedGlyphContours(faces: readonly IFace[]): Contour2D[] {
    const contours: Contour2D[] = [];
    for (const face of faces) {
        for (const wire of face.findSubShapes(ShapeTypes.wire) as IWire[]) {
            const contour = contourOfWire(wire);
            if (contour !== undefined) contours.push(contour);
        }
    }
    return contours;
}

/**
 * One wire as a contour, in the kernel's own traversal order (`edgeLoop` walks the wire).
 * Undefined — the reason warned — for a wire whose edges do not chain or do not close:
 * storing the half-loop would draw a seam that is not there.
 */
function contourOfWire(wire: IWire): Contour2D | undefined {
    const edges = wire.edgeLoop();
    if (edges.length === 0) return undefined;

    const start = edges[0].startPoint();
    const segments: Segment2D[] = [];
    let tip = start;
    for (const edge of edges) {
        if (edge.startPoint().distanceTo(tip) > Precision.Distance) {
            Logger.warn("Skipped a fused text wire whose edges do not chain");
            return undefined;
        }
        const read = segmentsOfEdge(edge);
        if (read === undefined) return undefined;
        segments.push(...read);
        tip = edge.endPoint();
    }
    if (tip.distanceTo(start) > Precision.Distance || segments.length === 0) {
        Logger.warn("Skipped a fused text wire that does not close");
        return undefined;
    }
    // Snap the chain shut: the last curve's end and the first vertex can sit a kernel
    // tolerance apart, and a stored contour closes exactly or not at all.
    segments[segments.length - 1] = { ...segments[segments.length - 1], to: vec2Of(start) };
    return { start: vec2Of(start), segments: mergeCollinearLines(segments, vec2Of(start)) };
}

/**
 * Consecutive lines folded into one when the vertex between them lies on the merged span:
 * a fuse splits a straight run at every crossing, and those split vertices are not corners
 * of the glyph. The test is the vertex's distance to the span, and at PConfusion only a
 * vertex the kernel cut out of one line passes — a sampled chord's vertex never would
 * (dropping it would double the chord's share of the error past SAMPLE_TOLERANCE). Only
 * lines fold; a bezier is exact and stays as read. No wrap-around: the seam between the
 * last and first segments is the contour's start, and it stays put.
 */
function mergeCollinearLines(segments: Segment2D[], start: Vec2): Segment2D[] {
    const merged: Segment2D[] = [];
    let runStart = start; // where the line run ending at the tail of `merged` began
    let prev = start; // where the next segment begins
    for (const segment of segments) {
        const tail = merged[merged.length - 1];
        if (
            segment.kind === "line" &&
            tail?.kind === "line" &&
            pointOffLine(prev, runStart, segment.to) <= Precision.PConfusion
        ) {
            merged[merged.length - 1] = { kind: "line", to: segment.to };
        } else {
            merged.push(segment);
            runStart = prev;
        }
        prev = segment.to;
    }
    return merged;
}

/** How far `point` lies off the segment a→b. */
function pointOffLine(point: Vec2, a: Vec2, b: Vec2): number {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const lengthSquared = ab.x ** 2 + ab.y ** 2;
    const t =
        lengthSquared < 1e-30
            ? 0
            : Math.min(1, Math.max(0, ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSquared));
    return Math.hypot(point.x - (a.x + ab.x * t), point.y - (a.y + ab.y * t));
}

/**
 * One edge as the segment its curve is: a line, the bezier piece the window cuts, or — for
 * the curve kinds a fuse can promote (a bspline) or that cannot be stated (past-cubic
 * bezier) — a sampled run of lines. Undefined when the edge will not read at all.
 */
function segmentsOfEdge(edge: IEdge): Segment2D[] | undefined {
    const from = edge.startPoint();
    const to = edge.endPoint();

    let curve: ITrimmedCurve;
    try {
        // a degenerate edge reports with a JS-level throw, which survives the WASM build
        curve = edge.curve;
    } catch (error) {
        Logger.warn(`Skipped a fused text edge: ${error}`);
        return undefined;
    }

    // The wrapper's window runs along the basis curve whichever way the wire walks the
    // edge, so the traversal direction is read off the endpoints.
    const forward =
        from.distanceTo(curve.value(curve.firstParameter())) <=
        from.distanceTo(curve.value(curve.lastParameter()));

    const [basis, u1, u2] = basisWindow(curve);
    if (basis.curveType === "line") {
        return [{ kind: "line", to: vec2Of(to) }];
    }
    if (basis.curveType === "bezierCurve") {
        const segment = bezierSegment(basis as IBezierCurve, u1, u2, from, to, forward);
        if (segment !== undefined) return [segment];
        // a degree the sidecar cannot say — fall through to the sampled reading
    }
    return sampledSegments(curve, from, to, forward);
}

/**
 * The curve under the trim wrappers, with the window in ITS parameters. `edge.curve` is
 * always a trimmed wrapper (`Edge::curve` builds one); a doubly-trimmed one intersects
 * windows, since a trim passes its basis's parameters through.
 */
function basisWindow(curve: ITrimmedCurve): [basis: ICurve, u1: number, u2: number] {
    let basis: ICurve = curve;
    let u1 = curve.firstParameter();
    let u2 = curve.lastParameter();
    while (basis.curveType === "trimmedCurve") {
        const inner = (basis as ITrimmedCurve).basisCurve;
        u1 = Math.max(u1, inner.firstParameter());
        u2 = Math.min(u2, inner.lastParameter());
        basis = inner;
    }
    return [basis, u1, u2];
}

/**
 * The bezier's piece between u1 and u2 as one segment. A fuse cuts an edge's curve at the
 * crossing points, so what is stored must be the piece — and a piece of a bezier is a
 * bezier: the de Casteljau split is exact, and nothing here flattens a curve to lines.
 * The ends snap to the edge's own vertices, which the window ends match to a kernel
 * tolerance and the chain has to match exactly.
 */
function bezierSegment(
    basis: IBezierCurve,
    u1: number,
    u2: number,
    from: XYZ,
    to: XYZ,
    forward: boolean,
): Segment2D | undefined {
    const poles = windowPoles(basis.poles(), u1, u2);
    if (poles === undefined) return undefined;
    if (!forward) poles.reverse();
    poles[0] = from;
    poles[poles.length - 1] = to;

    // p0 is the window's start — the chain supplies it, only the interior poles are stated
    const [, p1, p2, p3] = poles.map(vec2Of);
    switch (poles.length) {
        case 2:
            return { kind: "line", to: p1 };
        case 3:
            return { kind: "quad", c1: p1, to: p2 };
        default:
            return { kind: "cubic", c1: p1, c2: p2, to: p3 };
    }
}

/**
 * The poles of the [u1, u2] window of a [0, 1]-bezier: split at u2 and keep the left, then
 * split that at u1's share of it and keep the right. Undefined for a degree no segment
 * kind can state (fewer than two poles, or past cubic).
 */
function windowPoles(poles: XYZ[], u1: number, u2: number): XYZ[] | undefined {
    if (poles.length < 2 || poles.length > 4) return undefined;

    let windowed = poles;
    let span = 1;
    if (u2 < 1 - Precision.PConfusion) {
        windowed = splitBezier(windowed, u2)[0];
        span = u2;
    }
    if (u1 > Precision.PConfusion) {
        // clamped: the window end can sit a parametric tolerance past where it belongs
        windowed = splitBezier(windowed, clamp01(u1 / span))[1];
    }
    return windowed;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** The two pole polygons a bezier splits into at t — de Casteljau, exact for any degree. */
function splitBezier(poles: XYZ[], t: number): [left: XYZ[], right: XYZ[]] {
    const left: XYZ[] = [poles[0]];
    const right: XYZ[] = [poles[poles.length - 1]];
    let level = poles;
    while (level.length > 1) {
        const next: XYZ[] = [];
        for (let i = 0; i < level.length - 1; i++) {
            next.push(level[i].multiply(1 - t).add(level[i + 1].multiply(t)));
        }
        left.push(next[0]);
        right.push(next[next.length - 1]);
        level = next;
    }
    right.reverse();
    return [left, right];
}

/**
 * A curve the stored form cannot state, as the polyline that stays within the tolerance of
 * it: the count doubles until the mid-samples lie on their chords, capped so a pathological
 * curve cannot take the layout down with it. Sampled on the trimmed wrapper, whose window
 * is the edge's own.
 */
function sampledSegments(
    curve: ITrimmedCurve,
    from: XYZ,
    to: XYZ,
    forward: boolean,
): Segment2D[] | undefined {
    const points = sampledPoints(curve);
    if (points === undefined) {
        Logger.warn("Skipped a fused text edge whose curve would not sample");
        return undefined;
    }
    if (!forward) points.reverse();
    points[0] = from;
    points[points.length - 1] = to;

    const segments: Segment2D[] = [];
    for (let i = 1; i < points.length; i++) {
        // an abscissa solver can repeat a point at a cusp; a zero-length segment is no edge
        if (points[i].distanceTo(points[i - 1]) <= Precision.Distance) continue;
        segments.push({ kind: "line", to: vec2Of(points[i]) });
    }
    if (segments.length === 0) {
        Logger.warn("Skipped a fused text edge with no length");
        return undefined;
    }
    return segments;
}

/** The window sampled by count, doubled until the chords hold the tolerance or the cap says enough. */
function sampledPoints(curve: ITrimmedCurve): XYZ[] | undefined {
    let count = 16;
    let points = curve.uniformAbscissaByCount(count);
    while (count < SAMPLE_CAP) {
        const doubled = curve.uniformAbscissaByCount(count * 2);
        // the kernel answers with an empty array rather than raising on a degenerate curve
        if (points.length !== count + 1 || doubled.length !== count * 2 + 1) return undefined;
        if (worstChordGap(doubled) <= SAMPLE_TOLERANCE) return doubled;
        points = doubled;
        count *= 2;
    }
    return points.length >= 2 ? points : undefined;
}

/**
 * The worst distance from a mid-sample (the odd indices of the doubled run) to its chord —
 * the chord error of the coarser run, since the even indices are its points.
 */
function worstChordGap(doubled: readonly XYZ[]): number {
    let worst = 0;
    for (let i = 1; i + 1 < doubled.length; i += 2) {
        worst = Math.max(worst, pointOffSegment(doubled[i], doubled[i - 1], doubled[i + 1]));
    }
    return worst;
}

/** How far `point` lies off the segment a→b. */
function pointOffSegment(point: XYZ, a: XYZ, b: XYZ): number {
    const ab = b.sub(a);
    const lengthSquared = ab.length() ** 2;
    const t = lengthSquared < 1e-30 ? 0 : Math.min(1, Math.max(0, point.sub(a).dot(ab) / lengthSquared));
    return point.distanceTo(a.add(ab.multiply(t)));
}

/** (x, y) of a kernel point — the layout builds on z = 0, and that is all a contour stores. */
function vec2Of(point: XYZ): Vec2 {
    return { x: point.x, y: point.y };
}
