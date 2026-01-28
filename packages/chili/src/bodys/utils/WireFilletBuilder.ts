// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IShapeFactory,
    type IWire,
    MathUtils,
    Precision,
    Result,
    type XYZ,
} from "chili-core";

export class WireFilletBuilder {
    constructor(private factory: IShapeFactory) {}

    build(path: IWire, radius: number): Result<IWire> {
        const edges = path.edgeLoop();
        if (edges.length < 2 || radius <= Precision.Distance) {
            return Result.ok(path);
        }

        const newEdges: IEdge[] = [];

        // Iterate through corners logic was simplified in previous steps to just vertex reconstruction
        // But for clarity/completeness of the algorithm used:
        // We reconstructed vertices first.

        const vertices: XYZ[] = [];
        const firstC = edges[0].curve;
        vertices.push(firstC.value(firstC.firstParameter()));
        for (const e of edges) {
            const c = e.curve;
            vertices.push(c.value(c.lastParameter()));
        }

        const filletedEdges: IEdge[] = [];
        let previousPoint = vertices[0];

        for (let i = 1; i < vertices.length - 1; i++) {
            const V = vertices[i];
            const P_prev = vertices[i - 1];
            const P_next = vertices[i + 1];

            const u = P_prev.sub(V).normalize();
            const v = P_next.sub(V).normalize();

            // Check for degenerate cases (collinear, opposite)
            if (!u || !v || u.isParallelTo(v) || u.isOppositeTo(v, Precision.Angle)) {
                // No bend, just add line to V
                if (previousPoint.distanceTo(V) > Precision.Distance) {
                    const lineRes = this.factory.line(previousPoint, V);
                    if (lineRes.isOk) filletedEdges.push(lineRes.value);
                }
                previousPoint = V;
                continue;
            }

            const angle = u.angleTo(v);
            if (!angle || Math.abs(angle - Math.PI) < Precision.Angle) {
                if (previousPoint.distanceTo(V) > Precision.Distance) {
                    const lineRes = this.factory.line(previousPoint, V);
                    if (lineRes.isOk) filletedEdges.push(lineRes.value);
                }
                previousPoint = V;
                continue;
            }

            const halfAngle = angle / 2;
            let T = radius / Math.tan(halfAngle);

            const distPrev = V.distanceTo(P_prev);
            const distNext = V.distanceTo(P_next);
            const limit = Math.min(distPrev, distNext) / 2.05;

            if (T > limit) {
                T = limit; // Clamp
            }

            const Pt1 = V.add(u.multiply(T)); // Point on incoming segment
            const Pt2 = V.add(v.multiply(T)); // Point on outgoing segment

            // Add line from previous to start of arc
            if (previousPoint.distanceTo(Pt1) > Precision.Distance) {
                const lineRes = this.factory.line(previousPoint, Pt1);
                if (lineRes.isOk) {
                    filletedEdges.push(lineRes.value);
                }
            }

            // Add arc
            // Center calculation using tangent length (T) to ensure tangency even if clamped
            const distCenter = T / Math.cos(halfAngle);
            const bisector = u.add(v).normalize()!;
            const Center = V.add(bisector.multiply(distCenter));

            // Normal: v cross u for correct orientation (reflex angle check)
            const normal = v.cross(u).normalize();
            if (!normal) {
                if (previousPoint.distanceTo(V) > Precision.Distance) {
                    const lineRes = this.factory.line(previousPoint, V);
                    if (lineRes.isOk) filletedEdges.push(lineRes.value);
                }
                previousPoint = V;
                continue;
            }

            const arcAngleDeg = 180 - MathUtils.radToDeg(angle);

            const arcRes = this.factory.arc(normal, Center, Pt1, arcAngleDeg);
            if (arcRes.isOk) {
                const arcEdge = arcRes.value;
                filletedEdges.push(arcEdge);

                // CRITICAL: Use the actual end point of the arc as the start for the next line
                const arcCurve = arcEdge.curve;
                const arcEnd = arcCurve.value(arcCurve.lastParameter());
                previousPoint = arcEnd;
            } else {
                // Fallback: Connect to V
                if (previousPoint.distanceTo(V) > Precision.Distance) {
                    const gapLine = this.factory.line(previousPoint, V);
                    if (gapLine.isOk) filletedEdges.push(gapLine.value);
                }
                previousPoint = V;
            }
        }

        // Add last segment
        const lastP = vertices[vertices.length - 1];
        if (previousPoint.distanceTo(lastP) > Precision.Distance) {
            const lastLine = this.factory.line(previousPoint, lastP);
            if (lastLine.isOk) filletedEdges.push(lastLine.value);
        }

        return this.factory.wire(filletedEdges);
    }
}
