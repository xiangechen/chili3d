// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { Result } from "../foundation";
import type { XYZ, XYZLike } from "../math";
import type { VisualShapeData } from "../visual";

/**
 * What an annotation measures, in a form that survives the source's rebuild.
 *
 * The geometry identity (`edge`, `ref`) is resolver-owned and opaque to core — parametric's
 * `EdgeRef`/`ProfileRef`/`VertexRef` in the shipped resolver. Core carries it from the pick
 * to the later resolve and stores the whole association as JSON on the annotation (the
 * serializer refuses plain objects).
 */
export type AnnotationAssociation =
    | CircleEdgeAssociation
    | PointAssociation
    | PointPairAssociation
    | EdgePairAssociation;

/**
 * A radial/diameter dimension bound to a circular edge.
 *
 * `axis`, `leader` and `distance` describe where the text sits relative to the circle,
 * so a rebuild can re-place the label rather than leave it behind. They are world-space
 * at capture time: a body that rotates must rotate this placement with it.
 */
export interface CircleEdgeAssociation {
    readonly kind: "circleEdge";
    readonly nodeId: string;
    /** Resolver-owned edge identity. Opaque to core. */
    readonly edge: unknown;
    /** The circle's axis in world space at capture time. */
    readonly axis: XYZLike;
    /** Unit direction from the circle's center to the text point, world space. */
    readonly leader: XYZLike;
    /** Distance from the center to the text point, world space (mm). */
    readonly distance: number;
}

/**
 * One picked point: either a free coordinate (`nodeId`/`ref` absent) or a point on a
 * node's sub-shape. `on` says where on that sub-shape the pick sat, so the point can be
 * reproduced after the sub-shape moves or is re-trimmed — an edge's normalized parameter
 * or a face-surface `(u, v)`. A vertex carries no `on`: its fingerprint is the point.
 *
 * `point` is the world position at capture time. It is the anchor itself when the point
 * is free, and keeps a human-readable position for the attached case.
 */
export interface PointAnchor {
    readonly nodeId?: string;
    readonly ref?: unknown;
    readonly on?:
        | {
              readonly kind: "edge";
              /** Normalized parameter along the picked edge. */
              readonly t: number;
              /**
               * The picked edge's endpoints, local, as captured. A rebuilt edge may be
               * parameterized the other way round — the matcher accepts a reversed
               * fingerprint — so the resolve compares these with the matched edge's
               * endpoints and flips `t` when the direction reversed.
               */
              readonly start?: XYZLike;
              readonly end?: XYZLike;
          }
        | { readonly kind: "face"; readonly u: number; readonly v: number };
    readonly point: XYZLike;
}

/** A picked edge (a straight edge for angles, any edge for point-on-edge anchors). */
export interface EdgeAnchor {
    readonly nodeId: string;
    /** Resolver-owned edge identity. Opaque to core. */
    readonly ref: unknown;
}

/** A text callout's leader bound to one picked point. */
export interface PointAssociation {
    readonly kind: "point";
    readonly anchor: PointAnchor;
}

/** A linear distance or a reference segment: two picked points. */
export interface PointPairAssociation {
    readonly kind: "pointPair";
    readonly start: PointAnchor;
    readonly end: PointAnchor;
    /** Where the label sits, on a distance dimension; absent on a reference segment. */
    readonly placement?: LinearTextPlacement;
}

/** An angular dimension: two picked straight edges. */
export interface EdgePairAssociation {
    readonly kind: "edgePair";
    readonly first: EdgeAnchor;
    readonly second: EdgeAnchor;
    readonly placement: AngleTextPlacement;
}

/**
 * Linear label placement in the measured segment's frame, in world millimetres:
 * `along` from the start point, `lateral` toward the side the label sits on, with the
 * dimension plane's `normal` pinned so an edit that turns the segment keeps the side.
 */
export interface LinearTextPlacement {
    readonly along: number;
    readonly lateral: number;
    readonly normal: XYZLike;
}

/**
 * Angular label placement, in the angle frame (first direction + normal):
 *
 * - `radius` — the distance from the vertex.
 * - `reflex` — the **sweep** is the reflected one (`theta2 − 2π`). This is what the
 *   measured value reads; it is not derivable from the drawn text position.
 * - `flip` — the layout starts the arc half a turn round because the picked label sits
 *   across the sweep's bisector.
 *
 * Two bits are needed because a short sweep and a flipped reflex sweep draw the text at
 * the same place while measuring different angles (90° vs 270°). Storing the label
 * side alone loses the value; storing the bit pair plus the radius rebuilds both.
 */
export interface AngleTextPlacement {
    readonly radius: number;
    readonly reflex: boolean;
    readonly flip: boolean;
}

/** A line a resolved edge anchor names, in world space. */
export interface ResolvedLine {
    readonly start: XYZ;
    readonly end: XYZ;
}

/** The circle a circle-edge association currently measures, in world space. */
export interface ResolvedCircleEdge {
    readonly center: XYZ;
    readonly radius: number;
    readonly axis: XYZ;
}

/** The world geometry a whole association resolves to, tagged like the association. */
export type ResolvedAssociation =
    | { readonly kind: "circleEdge"; readonly circle: ResolvedCircleEdge }
    | { readonly kind: "point"; readonly point: XYZ }
    | { readonly kind: "pointPair"; readonly start: XYZ; readonly end: XYZ }
    | { readonly kind: "edgePair"; readonly first: ResolvedLine; readonly second: ResolvedLine };

/**
 * Re-finds associated geometry on rebuilt nodes. Implemented by the feature package
 * that owns the reference format (parametric), registered by the builder — the
 * annotation commands and the annotation model live in core/app and cannot import it.
 */
export interface IAnnotationAssociationResolver {
    /** Capture the picked circle edge; undefined when the pick is not a bindable one. */
    captureCircleEdge(picked: VisualShapeData, textPoint: XYZ): CircleEdgeAssociation | undefined;
    /** Capture one picked point. A free point is a valid anchor; it just never updates. */
    capturePointAnchor(picked: VisualShapeData | undefined, worldPoint: XYZ): PointAnchor;
    /** Capture a picked edge for an angle; undefined when the pick is not a bindable edge. */
    captureEdgeAnchor(picked: VisualShapeData | undefined): EdgeAnchor | undefined;
    /** Re-find the circle on the node's current shape; the result is in world space. */
    resolveCircleEdge(document: IDocument, association: CircleEdgeAssociation): Result<ResolvedCircleEdge>;
    /** Resolve one anchor to a world point; a free anchor answers its stored position. */
    resolvePointAnchor(document: IDocument, anchor: PointAnchor): Result<XYZ>;
    /** Re-find an edge and return its current world line. */
    resolveEdgeAnchor(document: IDocument, anchor: EdgeAnchor): Result<ResolvedLine>;
}

/** The node ids an association reads — what the annotation follows for rebuilds. */
export function associationNodeIds(association: AnnotationAssociation): string[] {
    switch (association.kind) {
        case "circleEdge":
            return [association.nodeId];
        case "point":
            return anchorNodeIds(association.anchor);
        case "pointPair":
            return [...anchorNodeIds(association.start), ...anchorNodeIds(association.end)];
        case "edgePair":
            return [association.first.nodeId, association.second.nodeId];
    }
}

/** True when the anchor follows a node's geometry rather than a fixed coordinate. */
export function isAttachedAnchor(anchor: PointAnchor): boolean {
    return anchor.nodeId !== undefined && anchor.ref !== undefined;
}

function anchorNodeIds(anchor: PointAnchor): string[] {
    return isAttachedAnchor(anchor) && anchor.nodeId !== undefined ? [anchor.nodeId] : [];
}

let resolver: IAnnotationAssociationResolver | undefined;

/** Installs the association resolver; `undefined` turns every annotation static again. */
export function setAnnotationAssociationResolver(value: IAnnotationAssociationResolver | undefined): void {
    resolver = value;
}

export function getAnnotationAssociationResolver(): IAnnotationAssociationResolver | undefined {
    return resolver;
}
