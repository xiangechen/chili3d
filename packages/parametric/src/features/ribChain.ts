// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IShape, type Plane, Precision, Result, ShapeTypes, type XYZ } from "@chili3d/core";
import { shapeEntityIds } from "../sketch/sketchModel";
import type { SketchNode } from "../sketch/sketchNode";
import { samePoint } from "./profileSeeds";
import { INCIDENCE_TOLERANCE } from "./refGeometry";

/**
 * The chain a rib is built from: the sketch entities the user picked, plus the stubs that
 * "extend to part" adds, as one list the kernel can chain.
 *
 * A rib is the ONLY feature here that names open geometry, so it cannot use the profile
 * machinery: `ProfileRef`/`sketchProfiles` describe closed regions, and the profile layer drops
 * an entity group that does not close. The chain is therefore resolved and labelled here, and the
 * band it makes is the kernel's job — `facesFromEdges` bounds the region it encloses together with
 * the body's own section, and `sweepFaceTracked` gives that region the thickness (see `rib.ts`).
 *
 * The name is the rib's own: a SWEEP's spine is the path its profile travels ALONG, while a rib's
 * material grows sideways OFF this chain (see `RibFeatureData`).
 */
export interface RibChain {
    /** The chain edges, in the sketch's own edge order, with `labels` parallel to them. */
    readonly edges: IEdge[];
    /**
     * The base label of each edge: `ent<N>` for a sketch entity, `extStart`/`extEnd` for a stub an
     * extension added. A label repeats — one chain entity offsets into two band edges — and the
     * occurrence counter downstream is what tells those apart (`qualify` in `rib.ts`).
     */
    readonly labels: string[];
    /** The edges this module created. The caller disposes them once the kernel has read them. */
    readonly owned: IEdge[];
}

/**
 * The entities the chain names, read off the sketch's rebuilt geometry.
 *
 * The ids are matched against `shapeEntityIds`, which runs parallel to the edges
 * `SketchNode.generateShape` emits — the same pairing `sketchProfiles` uses. A miss is an error,
 * not a cue to go looking by shape: entity ids are never reused, so a miss means the entity is
 * gone, and adopting a look-alike would build a rib nobody drew.
 */
export function resolveChain(sketch: SketchNode, entityIds: readonly number[]): Result<RibChain> {
    const shape = sketch.shape;
    if (!shape.isOk) return Result.err("The rib sketch has no geometry");

    const all = shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];
    const ids = shapeEntityIds(sketch.data);
    const wanted = new Set(entityIds);
    const edges: IEdge[] = [];
    const labels: string[] = [];
    for (const [index, id] of ids.entries()) {
        if (!wanted.has(id) || index >= all.length) continue;
        edges.push(all[index]);
        labels.push(`ent${id}`);
    }
    if (edges.length === 0) return Result.err("The rib chain has no entities left in the sketch");
    return Result.ok({ edges, labels, owned: [] });
}

/**
 * Onshape's "Extend profiles to part": pushes each FREE END of the chain out along its own
 * tangent until it meets `target`, so a centerline drawn short of the walls still spans
 * them. The rule is "the first wall the tangent runs into", which makes the command
 * idempotent on a chain that already reaches: an end sitting ON the wall meets it at parameter
 * zero, so nothing is added and no degenerate stub is built. An end that meets nothing is an
 * error rather than a silent no-op — the rib the user asked for would not reach the body.
 *
 * An ARC end is extended by a straight line from the end of the arc, which is what the tangent
 * at that end is (measured from a step inside the edge, since the kernel exposes no tangent).
 */
export function extendChain(chain: RibChain, plane: Plane, target: IShape): Result<RibChain> {
    const ends = freeEnds(chain.edges);
    if (ends.length !== 2) {
        return Result.err("The rib chain must be one open run of edges");
    }

    const section = target.section(plane);
    try {
        const outline = section.findSubShapes(ShapeTypes.edge) as IEdge[];
        if (outline.length === 0) return Result.err("The rib plane does not cross the body");
        const reach = probeLength(target);

        const stubs: { edge: IEdge; label: string; atStart: boolean }[] = [];
        for (const [index, end] of ends.entries()) {
            const extended = extendEnd(end, outline, reach);
            if (!extended.isOk) {
                // The stubs already built are this call's own, and an error gives the caller
                // nothing to carry them in — without this they live until the finalizer.
                for (const stub of stubs) stub.edge.dispose();
                return Result.err(extended.error);
            }
            if (extended.value !== null) {
                stubs.push({
                    edge: extended.value,
                    label: index === 0 ? "extStart" : "extEnd",
                    atStart: index === 0,
                });
            }
        }
        if (stubs.length === 0) return Result.ok(chain);

        const edges = [...chain.edges];
        const labels = [...chain.labels];
        for (const stub of [...stubs].reverse()) {
            if (stub.atStart) {
                edges.unshift(stub.edge);
                labels.unshift(stub.label);
            } else {
                edges.push(stub.edge);
                labels.push(stub.label);
            }
        }
        return Result.ok({ edges, labels, owned: stubs.map((stub) => stub.edge) });
    } finally {
        section.dispose();
    }
}

interface FreeEnd {
    readonly point: XYZ;
    readonly edge: IEdge;
    /** Whether `point` is the edge's own start, which is what picks the tangent's sign. */
    readonly atStart: boolean;
}

/** The chain's two ends: the points exactly one edge reaches. */
function freeEnds(edges: readonly IEdge[]): FreeEnd[] {
    const grouped: { point: XYZ; ends: FreeEnd[] }[] = [];
    for (const edge of edges) {
        for (const atStart of [true, false]) {
            const point = atStart ? edge.startPoint() : edge.endPoint();
            const found = grouped.find((entry) => samePoint(entry.point, point));
            const end = { point, edge, atStart };
            if (found === undefined) grouped.push({ point, ends: [end] });
            else found.ends.push(end);
        }
    }
    const free = grouped.filter((entry) => entry.ends.length === 1).map((entry) => entry.ends[0]);
    // Ordered from the first edge's own start side, which is where the kernel's chain begins
    // (`chainEdges` starts at the first edge, unreversed) — so `extStart` names the same physical
    // end across rebuilds.
    const anchor = edges[0]?.startPoint();
    return anchor === undefined
        ? free
        : free.sort((a, b) => distanceTo(a.point, anchor) - distanceTo(b.point, anchor));
}

/**
 * The stub reaching `end`'s wall; `null` when the end already meets one, an error when it
 * reaches nothing at all.
 */
function extendEnd(end: FreeEnd, outline: readonly IEdge[], reach: number): Result<IEdge | null> {
    // An end already sitting on a wall has nothing to reach for. This cannot be left to the probe
    // below: an end ON the wall runs its tangent along that wall's far side, where there is no
    // crossing left to find, and the search would report a chain that plainly reaches as lost.
    if (outline.some((wall) => wall.curve.nearestFromPoint(end.point).distance <= INCIDENCE_TOLERANCE)) {
        return Result.ok(null);
    }
    const direction = outwardTangent(end);
    if (direction === undefined) return Result.err("A rib chain end has no direction to extend in");
    const probe = shapeFactory.line(end.point, end.point.add(direction.multiply(reach)));
    if (!probe.isOk) return Result.err(probe.error);
    try {
        let closest: number | undefined;
        for (const wall of outline) {
            for (const hit of probe.value.intersect(wall)) {
                // The probe is a straight edge, so its parameter IS the distance travelled. A hit
                // at zero is the end already sitting on the wall — nothing to add.
                if (
                    hit.parameter > Precision.Distance &&
                    (closest === undefined || hit.parameter < closest)
                ) {
                    closest = hit.parameter;
                }
            }
        }
        if (closest === undefined) {
            return Result.err("A rib chain end does not reach the body");
        }
        const stretched = shapeFactory.line(end.point, end.point.add(direction.multiply(closest)));
        return stretched.isOk ? Result.ok(stretched.value) : Result.err(stretched.error);
    } finally {
        probe.value.dispose();
    }
}

/** The direction the chain continues in past `end` (see `extendChain` on how it is measured). */
function outwardTangent(end: FreeEnd): XYZ | undefined {
    const [first, last] = [end.edge.firstParameter(), end.edge.lastParameter()];
    const step = (last - first) * 0.01;
    if (!(Math.abs(step) > 0)) return undefined;
    const inside = end.atStart ? end.edge.pointAt(first + step) : end.edge.pointAt(last - step);
    return end.point.add(inside.multiply(-1)).normalize();
}

/** How far to look along a tangent: past anything the body itself spans. */
function probeLength(target: IShape): number {
    const box = target.boundingBox();
    const diagonal = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    return diagonal > Precision.Distance ? diagonal * 2 : 1;
}

function distanceTo(point: XYZ, anchor: XYZ): number {
    return point.add(anchor.multiply(-1)).length();
}
