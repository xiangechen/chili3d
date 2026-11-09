// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IEdge,
    type IShape,
    type Plane,
    Precision,
    Result,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
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
 * `chain` split into its CONNECTED RUNS — edges that share an endpoint, transitively.
 *
 * A rib walks its chain end to end (`orderedChain` in `rib.ts`), so the pick is ONE polyline. A
 * sketch picked with several edges often holds several: three lines drawn across a bore are three
 * ribs, not one chain that cannot be walked, and each run is built on its own (the caller joins
 * the results). Edges that merely CROSS are not joined — a crossing is not an endpoint, and the
 * polyline the user drew is the only thing a rib follows.
 *
 * A run is a view of the chain, not a copy: its edges are the chain's own and each run comes back
 * with an empty `owned`, so the caller disposes nothing here — and the chain's own stubs (an
 * extension's) stay the CHAIN's to free, not the runs'.
 */
export function chainRuns(chain: RibChain): RibChain[] {
    // Each run keeps the chain's own relative order: a single run then hands back exactly the
    // chain it was given, which is what leaves the one-chain case's names untouched
    // (`ribbonFace` indexes labels by position).
    const parent = chain.edges.map((_, index) => index);
    const root = (index: number): number => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    };
    for (let i = 0; i < chain.edges.length; i++) {
        for (let j = i + 1; j < chain.edges.length; j++) {
            if (!sharesEndpoint(chain.edges[i], chain.edges[j])) continue;
            parent[root(i)] = root(j);
        }
    }
    const groups = new Map<number, number[]>();
    for (let index = 0; index < chain.edges.length; index++) {
        const key = root(index);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [index]);
        else group.push(index);
    }
    return [...groups.values()].map((indexes) => ({
        edges: indexes.map((index) => chain.edges[index]),
        labels: indexes.map((index) => chain.labels[index]),
        owned: [],
    }));
}

/** Whether two edges meet at a point — the connection the chain is walked along. */
function sharesEndpoint(edge: IEdge, other: IEdge): boolean {
    const [start, end] = [edge.startPoint(), edge.endPoint()];
    return (
        samePoint(start, other.startPoint()) ||
        samePoint(start, other.endPoint()) ||
        samePoint(end, other.startPoint()) ||
        samePoint(end, other.endPoint())
    );
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
    const section = target.section(plane);
    try {
        const outline = section.findSubShapes(ShapeTypes.edge) as IEdge[];
        if (outline.length === 0) return Result.err("The rib plane does not cross the body");
        try {
            return extendEnds(chain, outline, probeLength(target), () => true);
        } finally {
            // The wrappers own their kernel handles independently of the section (see `bringTo`).
            outline.forEach((edge) => {
                edge.dispose();
            });
        }
    } finally {
        section.dispose();
    }
}

/**
 * The chain carried from the sketch plane's section to a PARALLEL one: an end that sits ON the
 * sketch plane's wall but stands off this plane's is run on along its tangent until it lands.
 *
 * That is what a wall not parallel to the sweep needs. A cylinder's side, or a slanted face,
 * stands back from the sketch plane the further the plane is from it; a chain drawn exactly onto
 * the wall at the sketch plane then stops short of the wall everywhere else in the rib's
 * thickness, and the region the rib bounds on those planes would not close (`ribRegion` files
 * the planes together). Only an end the sketch plane's own outline holds is carried — a chain
 * deliberately drawn short must keep failing, not silently grow into a rib nobody drew.
 */
export function carryChain(
    chain: RibChain,
    sketchOutline: readonly IEdge[],
    outline: readonly IEdge[],
): Result<RibChain> {
    return extendEnds(chain, outline, outlineReach(outline), (end) => onOutline(end.point, sketchOutline));
}

/**
 * `chain` with a stub added past every end `wants` accepts, out along that end's own tangent
 * until the first wall of `outline` it meets. The stubs come back as the result's `owned`.
 */
function extendEnds(
    chain: RibChain,
    outline: readonly IEdge[],
    reach: number,
    wants: (end: FreeEnd) => boolean,
): Result<RibChain> {
    const ends = freeEnds(chain.edges);
    if (ends.length !== 2) {
        return Result.err("The rib chain must be one open run of edges");
    }

    const stubs: { edge: IEdge; label: string; atStart: boolean }[] = [];
    for (const [index, end] of ends.entries()) {
        if (!wants(end)) continue;
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
    if (onOutline(end.point, outline)) {
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

/** Whether `point` sits on one of `outline`'s walls (the incidence scale the extension probes at). */
function onOutline(point: XYZ, outline: readonly IEdge[]): boolean {
    return outline.some((wall) => wall.curve.nearestFromPoint(point).distance <= INCIDENCE_TOLERANCE);
}

/** How far to look along a tangent: past anything the body itself spans. */
function probeLength(target: IShape): number {
    return reachOf(target.boundingBox());
}

/** The reach for a section known only by its edges — the box of their union (see `reachOf`). */
function outlineReach(outline: readonly IEdge[]): number {
    let box: BoundingBox | undefined;
    for (const edge of outline) {
        box = BoundingBox.combine(box, edge.boundingBox());
    }
    return reachOf(box);
}

function reachOf(box: BoundingBox | undefined): number {
    if (box === undefined) return 1;
    const diagonal = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    return diagonal > Precision.Distance ? diagonal * 2 : 1;
}

function distanceTo(point: XYZ, anchor: XYZ): number {
    return point.add(anchor.multiply(-1)).length();
}
