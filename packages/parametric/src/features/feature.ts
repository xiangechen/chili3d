// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Continuity,
    type FeatureParameter,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type JoinType,
    type Matrix4,
    type ParameterValue,
    primaryAncestors,
    Result,
    type Scope,
    ShapeTypes,
    type SweepProfileMode,
    type TrackedShape,
    type XYZLike,
} from "@chili3d/core";
import type { DatumPlaneName, PlaneFaceRef } from "../sketch/planeRef";
import type { EdgeRef } from "./edgeRef";
import {
    completeEdgeHistory,
    completeFaceHistory,
    verifiedEdgeAncestors,
    verifiedFaceAncestors,
} from "./historyCompletion";
import type { ProfileRef } from "./profileRef";
import type { VertexRef } from "./vertexRef";

export interface FeatureBase {
    readonly id: string;
    readonly type: string;
    /** Suppressed features are skipped during evaluation and shown dimmed in the panel. */
    readonly suppressed?: boolean;
    /**
     * Variable-driven suppression: the feature is skipped whenever the named document
     * variable resolves to 0 (or, with `invert`, whenever it resolves to anything but 0).
     * Either this or `suppressed` being active suppresses the feature (logical OR). A
     * variable that is missing or does not resolve to a number suppresses NOTHING and
     * raises a feature-level warning instead — a typo'd name must never silently hide
     * geometry.
     */
    readonly suppressBy?: { readonly variable: string; readonly invert?: boolean };
    /** User-assigned display name, overriding the kind's default in the feature panel. */
    readonly name?: string;
}

/** Union of all feature payloads; grows as new feature kinds are added. */
export type FeatureData =
    | ExtrudeFeatureData
    | RevolveFeatureData
    | PrimitiveFeatureData
    | FilletFeatureData
    | ChamferFeatureData
    | BooleanFeatureData
    | LoftFeatureData
    | SweepFeatureData
    | ThickenFeatureData
    | ShellFeatureData
    | DraftFeatureData
    | RibFeatureData
    | MirrorFeatureData
    | PatternFeatureData
    | HoleFeatureData
    | RemoveFeatureFeatureData
    | SplitFeatureData
    | SewFeatureData
    | OffsetFaceFeatureData
    | HelixFeatureData
    | TransformFeatureData;

/**
 * A rigid placement applied to the whole chain input — how a parametric body "moves".
 *
 * The body's own `transform` stays identity: a transform feature is the only placement
 * that survives a rebuild, because the sketch (and every world-space pick downstream)
 * keeps its own coordinates. The matrix is stored as plain numbers rather than a
 * `Matrix4` so `featuresJson` and the rebuild cache key stay JSON round-trippable.
 *
 * `transformedMul` goes through OCCT's `gp_Trsf`, which represents only similarity
 * transforms (rigid, mirror, uniform scale). A non-uniform scale is silently
 * orthogonalized there, so the handler rejects anything that is not rigid
 * (orthonormal columns, |determinant| = 1); a mirror is allowed.
 */
export interface TransformFeatureData extends FeatureBase {
    readonly type: "transform";
    /** Column-major 4×4 in world space — the body's `transform` is identity. */
    readonly matrix: readonly number[];
}

export interface ExtrudeFeatureData extends FeatureBase {
    readonly type: "extrude";
    /** Sketch whose profiles are extruded; undefined when `source` faces are used instead. */
    readonly sketchId?: string;
    /**
     * Planar faces of an existing body to extrude from (press-pull), as profile
     * fingerprints captured in world coordinates (`profileRef.ts`). When `nodeId` is
     * the host body itself, the faces are re-matched on the feature's input shape.
     */
    readonly source?: { readonly nodeId: string; readonly profiles: ProfileRef[] };
    readonly depth: ParameterValue;
    /**
     * When true, the profiles are extruded by the forward depth in both directions of the
     * sweep direction. Mutually exclusive with `depth2`: setting BOTH is a rebuild error
     * rather than a silent winner — the user sees the conflict and clears one.
     */
    readonly symmetric?: boolean;
    /**
     * Flips the sweep direction (Onshape's Opposite Direction): a blind `depth` reaches
     * to the other side of the profile plane, an up-to/`throughAll` condition measures
     * along the flipped direction (a target on the natural side then lies behind the
     * start plane and is a rebuild error), and a press-pull sweeps AGAINST the face's
     * outward normal. The flip negates the sweep vectors, never their order: `depth2`
     * still lands on the side opposite the main sweep (so with `reverse` that is the
     * natural side), a `:neg` half keeps its ids, and a draft's narrow end moves with
     * the flip, since the taper's pull direction is the sweep vector itself. A
     * `direction` override's sense flips too; `startOffset` is NOT flipped — it keeps
     * the unflipped direction's sense. The extrude command composes this with the
     * drag's own sign: a backward drag already sweeps the other way, so the stored
     * value is drag-sign XOR the checkbox (both set is no flip at all).
     */
    readonly reverse?: boolean;
    /**
     * How the forward reach is determined (default `blind` — the prism stands `depth`
     * tall). `throughAll` infers a depth that carries the prism past the chain input's
     * far side (a preceding feature is required: standalone geometry has nothing to go
     * through); `upToFace`/`upToVertex` measure the depth from the profile plane to the
     * named target along the sweep direction. The stored `depth` stays the fallback the
     * feature builds with while an up-to target is missing or lost — the row reports the
     * lost pick (`ShapeTracking.unresolved`) instead of the feature failing.
     */
    readonly endCondition?: ExtrudeEndCondition;
    /**
     * `upToFace` target: a face of a node, as a profile fingerprint captured in WORLD
     * coordinates (`profileRef.ts`, the press-pull `source` contract — a world capture
     * doubles as the frozen fallback when the node is gone, its frame having gone with
     * it). The host's own id names a face of the chain input, matched on
     * `context.input`. A planar target parallel to the profile plane resolves exactly
     * (the end plane coincides with the target's plane); any other face — curved, or
     * planar but tilted — terminates at the face's FARTHEST point along the direction,
     * sampled from its wire vertices and bounding-box corners: the prism end clears the
     * whole face, which keeps cuts separating. An exact curved-surface termination needs
     * kernel `BRepFeat` support and is out of scope here.
     */
    readonly endFace?: { readonly nodeId: string; readonly profile: ProfileRef };
    /**
     * `upToVertex` target: a vertex of a node, captured in WORLD coordinates
     * (`vertexRef.ts` — a bare position, re-matched to the nearest vertex). Exact: the
     * end plane passes through the point.
     */
    readonly endVertex?: { readonly nodeId: string; readonly vertex: VertexRef };
    /**
     * Offset applied to the depth an up-to condition computed (default 0): positive
     * overshoots the target along the sweep direction, negative stops short of it.
     * Ignored by `blind` and `throughAll`.
     */
    readonly endOffset?: ParameterValue;
    /**
     * A second, independent depth for the direction OPPOSITE the sweep direction
     * (Onshape's second direction). Must be positive. Mutually exclusive with
     * `symmetric` — see there.
     */
    readonly depth2?: ParameterValue;
    /**
     * Sweep direction override: a line edge of a node, fingerprinted in that node's
     * LOCAL frame (the pattern `PatternLineSource` contract — start→end is the forward
     * sense). The host's own id names an edge of the chain input. Absent, the direction
     * is the profile plane's normal. A direction parallel to the profile plane is a
     * rebuild error (the prism would be degenerate). A lost ref builds from the frozen
     * fingerprint and reports through `ShapeTracking.unresolved`.
     */
    readonly direction?: { readonly nodeId: string; readonly edge: EdgeRef };
    /**
     * Distance the extrusion starts away from the profile plane, along the sweep
     * direction (positive moves the start in the direction's sense). Zero keeps the
     * start on the profile plane. The start offset is applied FIRST; an up-to/through
     * depth then measures from the profile plane to the target and subtracts the offset,
     * so the end lands on the target whatever the start offset is.
     */
    readonly startOffset?: ParameterValue;
    /**
     * Mould draft on the swept side faces, in degrees (undefined or 0 keeps the sides
     * straight — the plain prism path, unchanged). Positive narrows the prism toward its
     * end, negative flares it: each side face rotates about its intersection with the
     * sweep's START plane (the profile plane shifted by `startOffset`), so a symmetric or
     * `depth2` sweep tapers both halves off their shared start, parting-line style, and a
     * `throughAll` cut leaves a drafted through-hole. The magnitude must stay strictly
     * below 90°. Caveat: an up-to end sizes the prism's END to its target while the taper
     * rotates about the START, so a tapered up-to cut can stop short of spanning the
     * target face — the boolean stays valid; the opening it leaves is the tapered end.
     * The taper runs on each freshly swept prism before any fuse/boolean, so the tracked
     * ids compose (`extrudeDraft.ts`) instead of being re-matched geometrically afterwards.
     */
    readonly draftAngle?: ParameterValue;
    /**
     * How the prism combines with the preceding feature's shape on the host body —
     * Fusion-style join (fuse) / cut / intersect (common). Undefined creates standalone
     * geometry; set when the extrude command appends the feature to a target body.
     */
    readonly operation?: BooleanOperation;
    /**
     * Fingerprints of the sketch profiles to extrude (`profileRef.ts`); undefined or
     * empty extrudes every closed profile of the sketch.
     */
    readonly profiles?: ProfileRef[];
}

/** The forward end conditions of an extrude — see `ExtrudeFeatureData.endCondition`. */
export type ExtrudeEndCondition = "blind" | "throughAll" | "upToFace" | "upToVertex";

/** The placed primitives — what each kind builds is `primitive.ts`'s. */
export type PrimitiveKind = "box" | "cylinder" | "sphere" | "cone";

/**
 * Primitive: a box, cylinder, sphere or cone stood up at an explicit origin — no sketch,
 * no pick, the chain's usual starter geometry.
 *
 * Everything about the placement is a parameter (expressions included), so the feature carries
 * no fingerprints of its own except the optional direction override. Every size field is
 * optional: a field the user never typed falls back to the kind's default, so switching
 * `primitive` in the panel never strands the feature on sizes meant for another kind.
 */
export interface PrimitiveFeatureData extends FeatureBase {
    readonly type: "primitive";
    readonly primitive: PrimitiveKind;
    /**
     * Where the primitive stands, in world coordinates: a box's CORNER (the base rectangle
     * grows to the construction frame's +x/+y from it, and the box rises along the frame's
     * normal), a cylinder's and cone's BASE CENTER, a sphere's center. Components default to 0.
     */
    readonly origin?: { readonly x: ParameterValue; readonly y: ParameterValue; readonly z: ParameterValue };
    /** Box side lengths along the construction frame's x / y / normal; each defaults to 10. */
    readonly dx?: ParameterValue;
    readonly dy?: ParameterValue;
    readonly dz?: ParameterValue;
    /**
     * Cylinder and sphere radius; a cone's BASE radius (its top radius is `radius2`,
     * default 2 — 0 makes a pointed cone). Defaults to 5.
     */
    readonly radius?: ParameterValue;
    readonly radius2?: ParameterValue;
    /** Cylinder and cone height along the axis; defaults to 10. */
    readonly height?: ParameterValue;
    /**
     * Axis direction override: a line edge of a node, fingerprinted in that node's LOCAL
     * frame (the `PatternLineSource` contract — start→end is the sense, resolved like the
     * extrude's `direction`). Wins over `axis` when both are set. Meaningless for a sphere
     * and ignored there. A lost ref builds from the frozen fingerprint and reports through
     * `ShapeTracking.unresolved`.
     */
    readonly direction?: PatternLineSource;
    /**
     * The axis as a plain direction vector — what an interactive placement stores (the pick
     * plane's normal), where a live `direction` reference is more than the drag meant.
     * Normalized at resolve time; a degenerate vector is treated as absent. The axis falls
     * back to +Z only when BOTH this and `direction` are absent, and a sphere reads neither.
     */
    readonly axis?: XYZLike;
    /**
     * How the primitive combines with the preceding feature's shape on the host body —
     * Fusion-style join (fuse) / cut / intersect (common). Undefined creates standalone
     * geometry; a primitive that opens a chain carries none, and one asked to combine with
     * nothing is a rebuild error rather than a silent standalone.
     */
    readonly operation?: BooleanOperation;
}

export interface RevolveFeatureData extends FeatureBase {
    readonly type: "revolve";
    readonly sketchId: string;
    /**
     * Rotation axis in world space — a snapshot taken at creation time. When
     * `axisSource` is set it is re-derived from the referenced edge on every rebuild
     * and this only serves as a fallback (e.g. the source node was deleted).
     */
    readonly axis: { point: XYZLike; direction: XYZLike };
    /**
     * The axis as a reference: a line-edge fingerprint (`edgeRef.ts`) on another node,
     * re-matched against that node's current shape when it changes — moving the picked
     * axis line moves the revolve, like the axis reference in mainstream parametric CAD.
     */
    readonly axisSource?: { readonly nodeId: string; readonly edge: EdgeRef };
    /** In degrees. The forward angle when `angle2` is also set. */
    readonly angle: ParameterValue;
    /**
     * When true, `angle` is the TOTAL angle, swept half to each side of the profile
     * plane. Mutually exclusive with `angle2`: setting BOTH is a rebuild error rather
     * than a silent winner — the user sees the conflict and clears one.
     */
    readonly symmetric?: boolean;
    /**
     * A second, independent angle in degrees for the direction OPPOSITE the axis's
     * right-hand sense (Onshape's second direction). Must be positive.
     */
    readonly angle2?: ParameterValue;
    /**
     * Fingerprints of the sketch profiles to revolve (`profileRef.ts`); undefined or
     * empty revolves every closed profile of the sketch.
     */
    readonly profiles?: ProfileRef[];
    /**
     * How the revolved shape combines with the preceding feature's shape on the host
     * body — Fusion-style join (fuse) / cut / intersect (common). Undefined creates
     * standalone geometry; set when the revolve command appends the feature to a
     * target body.
     */
    readonly operation?: BooleanOperation;
}

export interface FilletFeatureData extends FeatureBase {
    readonly type: "fillet";
    readonly radius: ParameterValue;
    readonly edges: EdgeRef[];
    /**
     * The radius at every edge's END vertex when set — `radius` is the start vertex's, and
     * the kernel interpolates linearly along each edge (OCCT's two-radius fillet). Absent,
     * or equal to `radius`, is a constant-radius fillet and takes the plain kernel path.
     */
    readonly radius2?: ParameterValue;
}

/** The chamfer's distance convention — see `distance2`/`angle` for the asymmetric modes. */
export type ChamferMode = "equal" | "twoDistance" | "distanceAngle";

export interface ChamferFeatureData extends FeatureBase {
    readonly type: "chamfer";
    readonly distance: ParameterValue;
    readonly edges: EdgeRef[];
    /**
     * How the chamfer's two offsets are set: `equal` (default) puts `distance` on both
     * faces; `twoDistance` puts `distance` on the reference face and `distance2` on the
     * edge's other face; `distanceAngle` puts `distance` on the reference face and
     * `distance · tan(angle)` on the other (`angle` in degrees, 0 < angle < 90).
     */
    readonly mode?: ChamferMode;
    /** Second offset of a `twoDistance` chamfer — required by that mode, ignored otherwise. */
    readonly distance2?: ParameterValue;
    /** Slope angle of a `distanceAngle` chamfer, degrees — required by that mode. */
    readonly angle?: ParameterValue;
    /**
     * Swaps the face `distance` is measured on in the asymmetric modes: the reference face
     * defaults to the edge's first adjacent face, `flip` takes the second. Ignored by `equal`.
     */
    readonly flip?: boolean;
}

export type BooleanOperation = "fuse" | "cut" | "common";

export interface BooleanFeatureData extends FeatureBase {
    readonly type: "boolean";
    readonly operation: BooleanOperation;
    /** Node ids of the tool bodies; the body watches them for changes. */
    readonly toolIds: string[];
    /**
     * When true (the default), tool nodes become children of the body — hidden from
     * the scene, still listed and editable under the body in the model tree.
     */
    readonly consumeTools?: boolean;
}

/**
 * One ordered loft section:
 * - `profile` — a sketch profile (raw sketch-space fingerprint, `profileRef.ts`) or a
 *   solid face's outer wire (world-space fingerprint + the face's tracked id, the
 *   press-pull `source` contract); the node type decides which.
 * - `edge` — a single closed edge of a body, fingerprinted in the body's LOCAL space
 *   (it re-matches through `matchEdgesAnchored` on the node's own shape).
 * - `vertex` — a point section, allowed only as the first or last section; vertices
 *   carry no tracked ids, so the ref is a bare position (`vertexRef.ts`).
 */
export type LoftSectionData =
    | { readonly kind: "profile"; readonly nodeId: string; readonly profile: ProfileRef }
    | { readonly kind: "edge"; readonly nodeId: string; readonly edge: EdgeRef }
    | { readonly kind: "vertex"; readonly nodeId: string; readonly vertex: VertexRef };

export interface LoftFeatureData extends FeatureBase {
    readonly type: "loft";
    /** The sections to loft through, in order — at least two, at least one of them a wire. */
    readonly sections: LoftSectionData[];
    readonly isSolid: boolean;
    readonly isRuled: boolean;
    /** Smoothness of the transitions between sections; ignored when `isRuled`. */
    readonly continuity: Continuity;
    /**
     * How the lofted shape combines with the preceding feature's shape on the host
     * body — Fusion-style join (fuse) / cut / intersect (common). Undefined creates
     * standalone geometry; set when the loft command appends the feature to a target
     * body. A shell has no volume to combine with, so a shell loft (`isSolid: false`)
     * carrying one fails to build rather than ignoring it.
     */
    readonly operation?: BooleanOperation;
}

export interface SweepFeatureData extends FeatureBase {
    readonly type: "sweep";
    /** Sketch whose profiles are swept; undefined when `source` faces are used instead. */
    readonly sketchId?: string;
    /**
     * Planar faces of an existing body to sweep along the path (the press-pull
     * `source` contract — see `ExtrudeFeatureData`), as profile fingerprints
     * captured in world coordinates (`profileRef.ts`). When `nodeId` is the host
     * body itself, the faces are re-matched on the feature's input shape.
     */
    readonly source?: { readonly nodeId: string; readonly profiles: ProfileRef[] };
    /**
     * Fingerprints of the sketch profiles to sweep (`profileRef.ts`); undefined or
     * empty sweeps every closed profile of the sketch.
     */
    readonly profiles?: ProfileRef[];
    /**
     * The sweep path: edge fingerprints (`edgeRef.ts`) in the source node's LOCAL space,
     * re-matched against that node's current shape on every rebuild — editing the path
     * edges moves the sweep. The edges must connect into a single wire.
     */
    readonly path: { readonly nodeId: string; readonly edges: EdgeRef[] };
    /**
     * Transition mode at path corners (kernel `BRepBuilderAPI_RoundCorner` when true,
     * `RightCorner` otherwise).
     */
    readonly isRoundCorner?: boolean;
    /**
     * How the profile is oriented along the path (`SweepProfileMode`): `frenet` (default)
     * rotates it with the path's Frenet frame — what every sweep before this field ran;
     * `correctedFrenet` smooths frame discontinuities; `fixed` keeps the profile upright,
     * holding its in-plane up direction (world +Z projected into the profile plane) as a
     * constant binormal.
     */
    readonly profileControl?: SweepProfileMode;
    /**
     * How the swept shape combines with the preceding feature's shape on the host body —
     * Fusion-style join (fuse) / cut / intersect (common). Undefined creates standalone
     * geometry; set when the sweep command appends the feature to a target body.
     */
    readonly operation?: BooleanOperation;
}

/**
 * Thicken (Onshape's Thicken): offset a face — or a connected set of them, or a shell body's
 * whole surface — by a thickness into a solid.
 *
 * The faces are named by the press-pull `source` contract in `ExtrudeFeatureData`, and are
 * re-matched against the source body's rebuilt geometry the same way; a thicken is that feature's
 * sibling in everything but the kernel call it ends in (a sweep there, an offset here).
 */
export interface ThickenFeatureData extends FeatureBase {
    readonly type: "thicken";
    /** Faces of an existing body (or the host body itself) to thicken, as face fingerprints. */
    readonly source: { readonly nodeId: string; readonly profiles: ProfileRef[] };
    /** How far the solid reaches from the face on its own normal side. */
    readonly thickness: ParameterValue;
    /**
     * How far it reaches on the OPPOSITE side as well (Onshape's second thickness direction).
     * Absent means the solid stands on one side of the face only.
     */
    readonly thickness2?: ParameterValue;
    /**
     * Whether the thickness straddles the face — `thickness` becomes the TOTAL width, half of it
     * on each side (Onshape's Midplane). `thickness2` is ignored when set.
     */
    readonly midplane?: boolean;
    /** Flips which side `thickness` reaches to (Onshape's Opposite Direction). */
    readonly reverse?: boolean;
    /**
     * How the thickened solid combines with the preceding feature's shape on the host body —
     * Fusion-style join (fuse) / cut / intersect (common). Undefined creates standalone geometry.
     * A face is what a thicken is built from, so the solid it makes need not touch the body: a
     * `cut` takes it out of the input wherever it passes. A shell has no volume to combine with,
     * so a source with no enclosed space carrying one fails to build rather than ignoring it.
     */
    readonly operation?: BooleanOperation;
}

/**
 * Shell (Onshape's Shell): hollow the body's chain input to a wall thickness, leaving the picked
 * faces open.
 *
 * Unlike a thicken — which offsets faces it names from anywhere — a shell consumes the shape the
 * chain has built so far, so its faces are named by the press-pull `source` contract's fingerprint
 * type (`ProfileRef`) but resolved against `context.input` itself, and are re-matched there on
 * every rebuild. It is the edge features' sibling in that sense: a fillet names edges of the same
 * `context.input`, a shell names faces of it.
 */
export interface ShellFeatureData extends FeatureBase {
    readonly type: "shell";
    /**
     * Faces of the body's chain input to leave open, as face fingerprints in that input's LOCAL
     * space. The faces are real sub-shapes of the input, so no frame mapping is involved — and
     * must not be: the kernel matches them by identity.
     */
    readonly faces: ProfileRef[];
    /** Wall thickness, measured from the input's surface. */
    readonly thickness: ParameterValue;
    /**
     * Hollow outward instead of inward — the wall is added outside the input's boundary rather
     * than carved out of it (Onshape's negative thickness, Fusion's outside direction).
     */
    readonly outward?: boolean;
    /**
     * How the inner corners are built: rounded (`arc`, the default — each side is trimmed away
     * from the corner and its end sections stay arcs) or sharp (`intersection`). A styling choice
     * only: it never changes which sub-shapes exist, and the shell's ids do not depend on it.
     */
    readonly joinType?: JoinType;
}

/**
 * Offset Face (Fusion's and Onshape's Move Face › Offset): move the named faces along their own
 * outward normals, the faces that run smoothly into them following — a flat face grows or sinks
 * like a pad, a curved wall changes its radius, which is how a cylinder or a hole is resized.
 *
 * Named and resolved exactly as a shell's faces are: `ProfileRef` fingerprints matched against
 * `context.input` itself, never through a world-space transform, because the kernel matches a
 * face by identity and a transformed copy is a new TShape.
 *
 * A distance of 0 is an error rather than a no-op — there is no other reading of it. The sign is
 * the DIRECTION, and negative is not a lesser case: positive moves a face OUT (the body grows
 * there, a hole's wall closes in), so pulling a wall in is the same feature as pushing it out by
 * a negative distance.
 */
export interface OffsetFaceFeatureData extends FeatureBase {
    readonly type: "offsetFace";
    /** Faces of the body's chain input to move, as face fingerprints in that input's LOCAL space. */
    readonly faces: ProfileRef[];
    /** How far to move them along each face's own outward normal. A curved face's radius changes
     * by this much. 0 is rejected; the sign says which way. */
    readonly distance: ParameterValue;
    /**
     * Keep the radius of the rounds of a fillet that run into a moved face: they are taken off and
     * made again at their own radius, so moving a wall neither re-radiuses them nor drags the
     * faces past them along (Fusion's behavior, and what an imported `.f3d` expects).
     *
     * A REQUIREMENT, not a best effort. When the rounds beside a moving face cannot be re-made the
     * offset is REFUSED (kernel status 7), the feature's error is worded, and the body keeps the
     * shape it had — OCCT's own re-radiused body is never used as a silent fallback. A distance
     * that is itself impossible keeps its own answer (too far, with the bound) instead.
     *
     * ABSENT MEANS OFF, and that is deliberate rather than a defaulted-on convenience: an offset
     * saved before this option existed has no field, and reading it as ON would recompute it into a
     * different shape than the one it was saved as. A new offset written by the command sets it to
     * whatever the panel shows (on, unless turned off). This makes `true` a hard requirement for
     * documents written AFTER the option existed: one that used to re-evaluate into a re-radiused
     * body now fails instead. That is a deliberate, accepted behavior change.
     */
    readonly keepRounds?: boolean;
}

/**
 * The plane a draft rotates its faces about: one of the three global datums, a planar face
 * of a node, or another user-created datum plane (a `PlaneNode`). Deliberately built on the
 * SKETCH's plane reference (`PlaneFaceRef`, `planeRef.ts`) rather than a re-invention — it is
 * what the viewport plane picker produces, and it already carries both the tracked `faceId`
 * (precise re-match) and the `normal`+`offset` fingerprint (geometric fallback) that a
 * rebuild needs.
 *
 * The name and nothing else is stored for a datum: the three never move, so there is nothing to
 * re-match. A face ref is captured in WORLD coordinates (as a sketch's is) and mapped into the
 * host's own frame when the feature evaluates. A plane node is named by id and resolves through
 * its own definition, so editing that datum carries every user of it along.
 */
export type NeutralPlaneRef =
    | { readonly kind: "face"; readonly ref: PlaneFaceRef }
    | { readonly kind: "datum"; readonly name: DatumPlaneName }
    /** Another user-created datum plane, named by node: editing its definition moves this plane's users. */
    | { readonly kind: "planeNode"; readonly nodeId: string };

/** The node a plane ref lives on, or undefined for a global datum (which names no node). */
export function planeRefNodeId(ref: NeutralPlaneRef): string | undefined {
    if (ref.kind === "datum") return undefined;
    return ref.kind === "face" ? ref.ref.nodeId : ref.nodeId;
}

/**
 * Draft (Onshape's / Fusion's Draft): taper the named faces about their intersection with a
 * neutral plane, so a part can leave its mould.
 *
 * The faces are named and resolved exactly as a shell's are — `ProfileRef` fingerprints matched
 * against `context.input` itself, never through a world-space transform, because the kernel
 * matches them by identity and a transformed copy is a new TShape. The neutral plane is the one
 * thing resolved the other way round: it names geometry that may live on another node (or
 * nothing at all, for a datum), so it is captured and re-matched in world coordinates and then
 * mapped into the host's frame.
 */
export interface DraftFeatureData extends FeatureBase {
    readonly type: "draft";
    /** Faces of the body's chain input to taper, as face fingerprints in that input's LOCAL space. */
    readonly faces: ProfileRef[];
    /** The plane the tapers rotate about. */
    readonly neutralPlane: NeutralPlaneRef;
    /**
     * Taper angle in degrees (Onshape's and Fusion's unit). A negative angle keeps OCCT's
     * meaning — material added on the pull direction's side rather than removed — so it is not
     * clamped.
     */
    readonly angle: ParameterValue;
    /**
     * Flip the pull direction, which defaults to the neutral plane's normal (Fusion's Flip Pull
     * Direction / Onshape's angle-direction toggle). Which side material is taken from is the
     * only thing that changes: the taper's magnitude is the same either way.
     */
    readonly reverse?: boolean;
}

/**
 * Mirror (Onshape's Mirror part): the body's chain input mirrored about a plane — one of the
 * three global datums, or a planar face of a node, named exactly as a draft's neutral plane is
 * (`NeutralPlaneRef`, captured in world coordinates and mapped into the host's frame at
 * evaluation).
 *
 * The mirrored copy is not a referenced body: it is DERIVED from the chain input, so its identity
 * is the input's own. Its sub-shapes are named from the input's tracked ids under the feature's
 * scope (`mirror:<featureId>` — see `mirror.ts`), which is what a reference onto the mirrored
 * half re-matches against after an upstream edit.
 */
export interface MirrorFeatureData extends FeatureBase {
    readonly type: "mirror";
    /** The plane the chain input is mirrored about. */
    readonly plane: NeutralPlaneRef;
    /**
     * Fuse the mirrored copy with the input into one body (the default — Onshape's Merge scope).
     * False keeps the two halves side by side in one compound instead.
     */
    readonly merge?: boolean;
}

/**
 * A direction/axis reference a pattern runs along: a line edge of a node, fingerprinted in that
 * node's LOCAL frame (`edgeRef.ts`) — the revolve `axisSource` contract. The host's own id names
 * an edge of the chain input instead (resolved against `context.input`, the same self-reference
 * rule the revolve documents). When the ref cannot re-match — the node is gone, the edge no
 * longer exists — the stored fingerprint doubles as the frozen fallback geometry (a line ref
 * carries its endpoints), the loss is reported through `ShapeTracking.unresolved`, and the copies
 * keep building from the frozen line until the user re-picks.
 */
export interface PatternLineSource {
    readonly nodeId: string;
    readonly edge: EdgeRef;
}

/**
 * A path reference a curve pattern runs along: the edges of a node, fingerprinted in that node's
 * LOCAL frame — the sweep `path` contract. The edges need not arrive in order (a multi-pick
 * reports the click order); the feature sorts them into one end-to-end chain on every rebuild
 * (`orderPathEdges`), so the same connected geometry always walks the same way.
 */
export interface PatternPathSource {
    readonly nodeId: string;
    readonly edges: EdgeRef[];
}

/** How a curve pattern's copies face along the path (Onshape's Tangent / Locked). */
export type PatternOrientation = "tangent" | "locked";

interface PatternBase extends FeatureBase {
    readonly type: "pattern";
    /**
     * Total instance count INCLUDING the original (Onshape's Instance count): 3 places the
     * original plus two copies. Resolved from the document scope as a unitless whole number.
     */
    readonly count: ParameterValue;
    /**
     * Flattened indexes of the copies to skip — 0 is the FIRST COPY, the original has no index
     * and cannot be skipped. The flattening runs direction-1 first, then direction-2 (a grid's
     * first row, then the next), around the axis in rotation order, and along a curve pattern's
     * path in walk order; the index a copy carries never depends on which OTHER copies are
     * skipped, so editing the list does not rename the survivors. Out-of-range entries skip
     * nothing.
     */
    readonly skip?: number[];
    /**
     * Fuse every copy with the input into one body (the default — Onshape's Merge scope). False
     * keeps the original and the copies side by side in one compound instead.
     */
    readonly merge?: boolean;
}

/** Linear pattern (Onshape's): copies translated along an edge's direction — a grid when a second direction is set. */
export interface LinearPatternFeatureData extends PatternBase {
    readonly mode: "linear";
    /** The edge giving the copies' direction; the spacing runs along it. */
    readonly direction: PatternLineSource;
    /** Distance between consecutive instances along `direction`, in length units. */
    readonly spacing: ParameterValue;
    /**
     * Onshape's Direction 2: a second edge direction the grid grows along. When set, `count2` and
     * `spacing2` are required alongside it — the panel exposes the pair only then.
     */
    readonly direction2?: PatternLineSource;
    readonly count2?: ParameterValue;
    readonly spacing2?: ParameterValue;
}

/** Circular pattern (Onshape's): copies rotated about a line edge's axis. */
export interface CircularPatternFeatureData extends PatternBase {
    readonly mode: "circular";
    /** The edge giving the rotation axis (right-hand rule about its start→end direction). */
    readonly axis: PatternLineSource;
    /**
     * Total angle in degrees (default 360). With `equalSpacing` it is the arc the instances are
     * spread across; without it, the angle between the first and last instance.
     */
    readonly angle?: ParameterValue;
    /**
     * Even distribution within `angle` (the default): the step is `angle / count`, so a full
     * turn does not land the last copy on the original. False makes `angle` the first-to-last
     * span instead: the step is `angle / (count - 1)`.
     */
    readonly equalSpacing?: boolean;
}

/**
 * Curve pattern (Onshape's): copies distributed along an edge run, each turned with the path's
 * tangent (the default) or keeping the seed's orientation.
 */
export interface CurvePatternFeatureData extends PatternBase {
    readonly mode: "curve";
    /** The connected edge chain the copies run along. */
    readonly path: PatternPathSource;
    /**
     * Distance between consecutive instances along the path, in length units — read only when
     * `equalSpacing` is false. The path must be long enough for `(count − 1) · spacing`.
     */
    readonly spacing?: ParameterValue;
    /**
     * Evenly spread the instances over the path's whole length (the default): the step is
     * `length / (count − 1)` on an open path, `length / count` on a closed one, so a loop does
     * not land its last copy on the original.
     */
    readonly equalSpacing?: boolean;
    /** Tangent (the default) turns each copy with the path; locked only translates it. */
    readonly orientation?: PatternOrientation;
}

export type PatternFeatureData =
    | LinearPatternFeatureData
    | CircularPatternFeatureData
    | CurvePatternFeatureData;

/** What a hole cuts with: a plain drilled hole, a socket-head's counterbore, or a flat-head's countersink. */
export type HoleStyle = "simple" | "counterbore" | "countersink";

/**
 * Hole centers bound to standalone point entities of ONE sketch, by the sketch's own entity
 * ids. A bound center resolves on every rebuild: the entity's world position is projected
 * along the hole plane's normal onto it (the sketch need not lie on the hole face), so moving
 * or constraining the point moves the hole. A point picked near another sketch's entity once
 * a sketch is pinned degrades to a plain (u, v) center — one sketch keeps the binding's
 * "move the sketch, the pattern follows" reading unambiguous.
 */
export interface HoleSketchPoints {
    readonly sketchId: string;
    readonly entityIds: readonly number[];
}

/**
 * Hole (Onshape's Hole): drilled holes at points picked on a planar face — a material-removal
 * feature, so it always consumes the chain input (there is no standalone hole).
 *
 * The placement is the contract that makes holes FOLLOW the face: the face is a `PlaneFaceRef`
 * (world capture, re-matched on every rebuild — the draft/mirror neutral-plane system), and each
 * center is stored as (u, v) in the face plane's OWN frame rather than as a frozen world point, so
 * an upstream edit that moves the face carries the holes along. The frame is the sketch plane's
 * stable-origin frame (`sketchPlaneOfFace`) computed on the SOURCE-LOCAL face — an origin derived
 * from the world origin would drift when the body is merely moved.
 *
 * Depth convention: a blind `depth` measures from the plane to the drill POINT (the tip apex),
 * the way Fusion's "include drill tip" callout reads; the full-diameter part is therefore
 * `depth − r/tan(φ/2)`. `throughAll` (no `depth`) instead extends the hole solid so the
 * FULL-DIAMETER part clears the input's far side — the tip pokes out like a real drilled
 * through hole, and the removed material is a clean cylinder.
 *
 * Threads are deliberately out of scope: a tapped hole is a modeling-annotation concern (a
 * cosmetic thread plus a drawing callout), not a solid this feature cuts.
 */
export interface HoleFeatureData extends FeatureBase {
    readonly type: "hole";
    /**
     * The planar face the holes start from, captured in world coordinates (`planeRef.ts`).
     * Usually a face of the host's chain input; a face of another node resolves the same way a
     * mirror's plane does. A lost face builds from the frozen normal+offset fingerprint and
     * reports through `ShapeTracking.unresolved`.
     */
    readonly face: PlaneFaceRef;
    /**
     * Hole centers as (u, v) coordinates in the face plane's frame — see the type doc.
     * Picked directly on the face; `sketchPoints` carries the bound ones. The two lists
     * union at evaluation: raw centers keep slots 0..n−1 and bound ones
     * n..n+m−1, so a lost bound point leaves its slot EMPTY (reported through
     * `ShapeTracking.unresolved`) instead of shifting the survivors' sub-shape ids.
     */
    readonly points: [number, number][];
    /** Centers bound to sketch point entities — resolved and projected per rebuild. */
    readonly sketchPoints?: HoleSketchPoints;
    readonly style: HoleStyle;
    /** Drill diameter. */
    readonly diameter: ParameterValue;
    /** Blind depth INCLUDING the drill tip; absent drills through all (see the type doc). */
    readonly depth?: ParameterValue;
    /** Drill tip included angle in degrees (default 118, the general-purpose point). */
    readonly drillAngle?: ParameterValue;
    /** Socket-head recess; required when `style` is `counterbore`. */
    readonly counterbore?: { readonly diameter: ParameterValue; readonly depth: ParameterValue };
    /** Flat-head recess; required when `style` is `countersink` (angle defaults to 90°). */
    readonly countersink?: { readonly diameter: ParameterValue; readonly angle: ParameterValue };
}

/**
 * Rib (SolidWorks' and Onshape's): a thin fin standing on an OPEN sketch polyline, filling the
 * corner that polyline is drawn across. The material grows IN the sketch plane, from the chain out
 * until it lands on the body; the thickness stands it OFF the plane.
 *
 * The chain is the one reference in this module that names OPEN geometry. `ProfileRef` cannot
 * express it — every profile the sketch layer hands out is a closed region, and an open entity
 * group is dropped outright (`profileBuilder.ts` skips a wire that does not close) — so the
 * chain reuses the sweep path's contract instead: an edge run re-matched against its source
 * node on every rebuild. Unlike a sweep path, the chain lives in a sketch and therefore in
 * world coordinates, and the entity ids carry its identity (`SketchData`'s own ids, never
 * reused — see `shapeEntityIds`).
 */
export interface RibFeatureData extends FeatureBase {
    readonly type: "rib";
    /** The sketch whose open entities form the chain. */
    readonly sketchId: string;
    /**
     * The chain as the sketch's own entity ids (`shapeEntityIds`), in any order — the kernel
     * chains them. Editing an entity's endpoints moves the rib, which is the whole point of
     * naming the entity rather than the curve it happened to be drawn as.
     *
     * There is NO geometric fallback beside these, unlike a `ProfileRef`'s fingerprints: the
     * ids are allocated monotonically by the sketch and never reused, so a miss means the
     * entity was deleted. Re-matching *some other* curve by fingerprint would then silently
     * build a rib the user never drew — the feature fails instead.
     */
    readonly entityIds: number[];
    /**
     * How thin the fin is, measured along the sketch plane's NORMAL — the rib's thin axis, not
     * its in-plane width (that comes from what the corner the chain is drawn across measures).
     */
    readonly thickness: ParameterValue;
    /**
     * Onshape's "Extend profiles to part": push each free end of the chain out along its own
     * tangent until it meets the body, so a centerline drawn short of the walls still spans
     * them. Re-derived every rebuild (nothing about the stubs is stored), and a no-op on an end
     * that already reaches — it meets the wall at parameter zero.
     */
    readonly extend?: boolean;
    /**
     * How the rib combines with the preceding feature's shape on the host body. A rib is a
     * stiffener, so the command always sets one — "fuse" unless the user asked otherwise.
     */
    readonly operation?: BooleanOperation;
}

/**
 * Remove feature (Fusion's Delete Face with heal, Onshape's Delete face): delete the named
 * faces of the chain input and let the kernel close the wound — removing a fillet's face
 * un-fillets the corner, removing a hole's wall faces plugs the hole.
 *
 * The faces are named and resolved exactly as a shell's are (`ProfileRef` fingerprints matched
 * against `context.input` itself, never through a world-space transform — the kernel matches
 * them by identity). The kernel offers no tracked variant of the operation, so the result's
 * sub-shape ids fall back to geometric matching (`trackedIds`): a reference anchored across a
 * removeFeature re-matches by fingerprint.
 */
export interface RemoveFeatureFeatureData extends FeatureBase {
    readonly type: "removeFeature";
    /** Faces of the body's chain input to delete, as face fingerprints in that input's LOCAL space. */
    readonly faces: ProfileRef[];
}

/**
 * Split: cut the chain input with a plane, keeping both halves (one compound) or only the
 * piece on one side of it.
 *
 * The tool is a NEUTRAL PLANE (`NeutralPlaneRef` — a global datum or a planar face of a node),
 * resolved exactly as a draft's is. A planar tool only, deliberately: the kernel entry used
 * here (`IShape.split`, a BOPAlgo splitter) has no tracked variant, so the pieces' ids fall
 * back to geometric matching (`trackedIds`), and a planar cut's pieces re-match stably under
 * that fallback in a way a curved tool's would not. A non-planar face is rejected at pick
 * time; one hand-written into a file is a rebuild error.
 */
export interface SplitFeatureData extends FeatureBase {
    readonly type: "split";
    /** The plane to cut with. */
    readonly tool: NeutralPlaneRef;
    /**
     * Which side of the tool to keep: `both` (the default) keeps every piece as one compound;
     * `positive` keeps the piece(s) on the side the plane's normal points to, `negative` the
     * opposite ones. A side whose pieces vanished (the plane misses the input) is an error,
     * never a silent empty.
     */
    readonly keepSide?: "both" | "positive" | "negative";
}

/**
 * Sew (minimal): stitch the chain input — loose faces, shells, or a compound of those — into
 * one shell, the way the app's Sew command does (a `repairShape` pass follows the kernel sew).
 *
 * The semantic boundary is deliberately narrow: the input must contain only faces and shells.
 * A SOLID is rejected outright — there is nothing to sew, and the kernel returning it
 * unchanged would pretend one happened. Cross-node sewing is NOT supported; the feature
 * consumes the chain input only.
 */
export interface SewFeatureData extends FeatureBase {
    readonly type: "sew";
    /**
     * Sewing tolerance in length units; undefined uses the kernel's own default. Pairs of
     * edges further apart than this stay unsewn.
     */
    readonly tolerance?: ParameterValue;
}

/**
 * Helix: a helix WIRE (a spring's centreline) standing alone as the body's whole chain —
 * no preceding feature, consumed as the path of a later sweep (its `path` edge reference
 * points at this body).
 *
 * The coil is defined by `radius` plus TWO of {`length`, `pitch`, `turns`} — the third is
 * derived (`length = pitch·turns`, `pitch = length/turns`, `turns = length/pitch`). When all
 * three are stored, `length` and `pitch` are authoritative and `turns` is re-derived (the
 * app's Helix command takes height and pitch, so they win the tie). Fewer than two is a
 * rebuild error. The kernel call gets `pitch` and the swept angle (`turns·360°`).
 */
export interface HelixFeatureData extends FeatureBase {
    readonly type: "helix";
    /**
     * Where the coil starts (its base centre), in world coordinates; components default to
     * 0 — the primitive feature's `origin` contract.
     */
    readonly origin?: { readonly x: ParameterValue; readonly y: ParameterValue; readonly z: ParameterValue };
    readonly radius: ParameterValue;
    /** Total height climbed along the axis, in length units. */
    readonly length?: ParameterValue;
    /** Height climbed per full turn, in length units. */
    readonly pitch?: ParameterValue;
    /** Full turns swept. */
    readonly turns?: ParameterValue;
    /**
     * Axis direction override: a line edge of a node, fingerprinted in that node's LOCAL frame
     * (the `PatternLineSource` contract a primitive's `direction` keeps). Wins over `axis` when
     * both are set. A lost ref builds from the frozen fingerprint and reports through
     * `ShapeTracking.unresolved`.
     */
    readonly direction?: PatternLineSource;
    /**
     * The axis as a plain direction vector — what an interactive placement stores (the pick
     * plane's normal, reversed when the height drag went against it), where a live `direction`
     * reference is more than the drag meant. Normalized at resolve time; a degenerate vector is
     * treated as absent. The axis falls back to +Z only when BOTH this and `direction` are
     * absent.
     */
    readonly axis?: XYZLike;
}

/**
 * What a feature may ask of the body replaying it: its identity (to recognise a
 * self-reference, e.g. an extrude sourced on the host's own face) and its world
 * transform (boolean tools are mapped into the body's local space). Deliberately
 * narrower than `ShapeNode` so a caller driving a chain — the re-pick preview
 * evaluator, which is not a shape node — need only provide these two.
 */
export interface IShapeHost {
    readonly id: string;
    worldTransform(): Matrix4;
}

export interface FeatureContext {
    readonly document: IDocument;
    readonly host: IShapeHost;
    /** Output of the previous feature; undefined for the first (profile) feature. */
    readonly input?: IShape;
    /** The document's parameter table, resolved for this rebuild. */
    readonly scope: Scope;
    /**
     * Set by the body so handlers can report stable sub-shape ids via the kernel's
     * shape history. `inputFaceIds`/`inputEdgeIds` are the ids of `input`'s faces and
     * edges (findSubShapes order, empty for profile features); a handler on the tracked
     * path fills the output arrays — left empty when tracking is unavailable.
     */
    readonly tracking?: ShapeTracking;
}

/**
 * Inputs a feature could not re-resolve this run. A feature with several picks (an
 * extrude's regions, a boolean's tools) builds from the ones it still has and reports
 * the rest here instead of failing whole — the row then says which picks are gone and
 * keeps the slot open for a re-pick, rather than dropping the user's choice.
 */
export interface UnresolvedInputs {
    /** The feature's field the lost inputs belong to (e.g. `profiles`, `toolIds`). */
    readonly key: string;
    /** Positions within that field's list, ascending. */
    readonly refIndexes: readonly number[];
}

/** Freshly matched anchors of an extrude's end-condition targets, for write-back. */
export interface ResolvedEndTargets {
    readonly endFace?: ProfileRef;
    readonly endVertex?: VertexRef;
}

export interface ShapeTracking {
    readonly inputFaceIds: readonly (string | undefined)[];
    outputFaceIds: (string | undefined)[];
    readonly inputEdgeIds: readonly (string | undefined)[];
    outputEdgeIds: (string | undefined)[];
    /**
     * Set by a profile-matching handler to the fingerprints of the faces it actually
     * matched this run; the body writes them back into the feature (re-anchoring) so
     * the next edit measures drift from the latest match, not the original pick.
     */
    resolvedProfiles?: ProfileRef[];
    /**
     * Set by an edge-matching handler to the per-ref anchors it actually matched
     * this run (`matchEdgesAnchored`, or a re-capture from the matched edge on the
     * untracked path): fillet/chamfer edges and revolve's axis edge. The body writes
     * them back into the feature, same re-anchoring contract as `resolvedProfiles`.
     */
    /**
     * POSITIONAL, one slot per stored ref — and a slot MAY be a hole, because `pattern`'s own
     * anchors are: a direction whose line could not be re-matched keeps its place empty (the ref is
     * kept, and the panel is told through `unresolved`) so its neighbour does not shift. A handler
     * writing a matcher's anchors (`matchEdgesAnchored`) has none to leave — that one fails the
     * whole match instead — so a reader that knows which it holds may index freely.
     */
    resolvedEdges?: (EdgeRef | undefined)[];
    /**
     * Set by a handler holding an extrude's end-condition targets to the anchors it
     * actually matched this run — the same re-anchoring contract as the profile/edge
     * channels, kept separate because those channels are already positional lists of
     * the feature's OWN profiles and edges.
     */
    resolvedTargets?: ResolvedEndTargets;
    /**
     * Picked inputs that no longer resolve this run (see `UnresolvedInputs`). Set by a
     * handler that built from the surviving picks; left undefined when everything
     * resolved, which is the normal case and the only one with no cost.
     */
    unresolved?: UnresolvedInputs;
}

/**
 * Maps kernel sub-shape history to stable ids: a sub-shape derived from an input sub-shape
 * keeps that id, and a sub-shape nothing can name gets NO id.
 *
 * **Why there is no fallback name.** The only name left for an unattributed sub-shape would
 * be its position in the output enumeration ("the n-th output of feature F") — and a rebuilt
 * body is free to re-enumerate, which hands that name to a NEIGHBOUR, silently. Every sweep
 * instead attributes what it can by content (`attributeSweepEdges` in profileSeeds.ts,
 * `attributeCornerEdges` in edgeCorner.ts); what is left is left id-less, and the matching
 * layer resolves it geometrically, failing loudly when the geometry is ambiguous rather than
 * trusting a name that may have drifted.
 *
 * **Documents that stored a positional id** (`f1@7`, from before this) simply stop matching:
 * the reference falls back to its geometric fingerprint, and the first successful rebuild
 * re-anchors it with a real id (`refreshAnchoredRefs`). No migration step, and none is needed
 * for the common case.
 */
export function trackedIds(
    inputIds: readonly (string | undefined)[],
    map: readonly number[],
): (string | undefined)[] {
    return map.map((inputIndex) =>
        inputIndex >= 0 && inputIndex < inputIds.length ? inputIds[inputIndex] : undefined,
    );
}

/**
 * Face ids for sweeps (prism/revol): face-history hits keep the input face id; a side
 * face generated from a profile edge takes that edge's seed — stable across rebuilds
 * even when the kernel re-enumerates faces (a mirrored profile flips the side-face
 * order); anything else gets no id, for the reason `trackedIds` gives.
 */
export function trackedFaceIds(
    inputFaceIds: readonly (string | undefined)[],
    inputEdgeIds: readonly (string | undefined)[],
    faceMap: readonly number[],
    faceEdgeMap?: readonly number[],
): (string | undefined)[] {
    return faceMap.map((inputIndex, outputIndex) => {
        if (inputIndex >= 0 && inputIndex < inputFaceIds.length) return inputFaceIds[inputIndex];
        const edgeIndex = faceEdgeMap?.[outputIndex] ?? -1;
        if (edgeIndex >= 0 && edgeIndex < inputEdgeIds.length) return inputEdgeIds[edgeIndex];
        return undefined;
    });
}

/** The completed maps of `completeTrackedHistory`, plus the enumerated output sub-shapes for reuse. */
export interface CompletedTrackedHistory {
    readonly edgeMap: number[];
    readonly faceMap: number[];
    /** `result.shape`'s sub-shapes in findSubShapes order — reused by callers for seed generation. */
    readonly outputEdges: IEdge[];
    readonly outputFaces: IFace[];
    /** The enumerated input edges, in the order the kernel's history indexes refer to. */
    readonly inputEdges: readonly IEdge[];
    readonly inputFaces: readonly IFace[];
}

/**
 * Geometry-identical completion of BOTH sub-shape kinds of a tracked kernel
 * history (`completeEdgeHistory`/`completeFaceHistory`): recovers the unchanged
 * sub-shapes a sparse kernel history missed, so they keep the input's stable id
 * instead of being left unnamed. Kernel geometry is read eagerly — call
 * before disposing any input shape.
 *
 * ORDERING CONTRACT (load-bearing): the kernel's history input enumerates the
 * MAIN shape's sub-shapes first, then each tool's in order, and the map indexes
 * point into that enumeration. Pass `inputs` in that same order — the consumers
 * of the completed maps (`mapOperationIds`' main/tool boundary, `mapFusedIds`,
 * `mapBooleanIds`) all interpret the indexes against it.
 *
 * `options.inputEdges`/`options.inputFaces` hand over sub-shape lists the caller already
 * enumerated (the sweep sites keep the profile's edges for seed generation), skipping the repeat
 * `findSubShapes`; the returned output lists are the enumerated result sub-shapes, for the same
 * reuse.
 *
 * The verified merge channel is NOT part of the result — a caller that wants it asks for it with
 * `trackedAncestors`, because the kernel reports pairs for every tracked op while only the merge
 * mappers read them, and verifying is the expensive half (see `trackedAncestors`).
 */
export function completeTrackedHistory(
    inputs: readonly IShape[],
    result: TrackedShape,
    enumerated?: {
        readonly inputEdges?: readonly IEdge[];
        readonly inputFaces?: readonly IFace[];
    },
): CompletedTrackedHistory {
    const inputEdges =
        enumerated?.inputEdges ?? inputs.flatMap((shape) => shape.findSubShapes(ShapeTypes.edge) as IEdge[]);
    const inputFaces =
        enumerated?.inputFaces ?? inputs.flatMap((shape) => shape.findSubShapes(ShapeTypes.face) as IFace[]);
    const outputEdges = result.shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const outputFaces = result.shape.findSubShapes(ShapeTypes.face) as IFace[];
    return {
        edgeMap: completeEdgeHistory(
            inputEdges,
            outputEdges,
            primaryAncestors(result.edgeAncestors, outputEdges.length),
        ),
        faceMap: completeFaceHistory(
            inputFaces,
            outputFaces,
            primaryAncestors(result.faceAncestors, outputFaces.length),
        ),
        outputEdges,
        outputFaces,
        inputEdges,
        inputFaces,
    };
}

/**
 * The kernel's merge channel, verified: the `(output, input)` pairs with every one the geometry
 * contradicts dropped (see `verifiedEdgeAncestors`), for the merge mappers that consume them.
 *
 * Deliberately a separate call rather than a field of `completeTrackedHistory`: the kernel now
 * reports pairs for EVERY tracked op — booleans, prisms, revolves, corners alike — while only
 * `mapBooleanIds`/`mapFusedIds`/`mapOperationIds` read the channel, and verifying costs an
 * `edgeLiesOn` in each direction per pair (several kernel queries each). A sweep or a corner
 * would pay all of it for nothing.
 *
 * Reads kernel geometry, so call it while the sub-shapes `completed` enumerated are still alive.
 */
export function trackedAncestors(
    completed: CompletedTrackedHistory,
    result: TrackedShape,
): { readonly edgeAncestors?: number[]; readonly faceAncestors?: number[] } {
    return {
        edgeAncestors: verifiedEdgeAncestors(
            result.edgeAncestors,
            completed.outputEdges,
            completed.inputEdges,
        ),
        faceAncestors: verifiedFaceAncestors(
            result.faceAncestors,
            completed.outputFaces,
            completed.inputFaces,
        ),
    };
}

/**
 * A node reference a feature declares — the body resolves `nodeId` against the
 * document to build the panel's link row (see `FeatureReference`).
 */
export interface FeatureNodeRef {
    readonly key: string;
    readonly display: I18nKeys;
    readonly nodeId: string;
}

/** Per-feature-kind behavior. Implementations live next to their feature file. */
export interface FeatureHandler<F extends FeatureData = any> {
    /** i18n key shown in the feature list; a function picks the key per feature (e.g. boolean operation). */
    readonly display: I18nKeys | ((feature: F) => I18nKeys);
    /** Iconfont key shown in the feature list; a function picks the icon per feature. */
    readonly icon?: string | ((feature: F) => string);
    /** Set when the user can re-pick the shapes the feature references (e.g. edges). */
    readonly reselectable?: boolean;
    evaluate(feature: F, context: FeatureContext): Result<IShape>;
    /** Ids of nodes this feature references — the body watches them for changes. */
    nodeIds(feature: F): string[];
    /**
     * Nodes the user is meant to reach from this feature (e.g. the sketch it
     * consumes), shown as link rows in its panel row. A subset of `nodeIds` in
     * practice: `nodeIds` is what the body must watch, this is what the user needs
     * a door to. Dangles are dropped, not rendered.
     */
    references?(feature: F): FeatureNodeRef[];
    parameters(feature: F): FeatureParameter[];
    setParameter(feature: F, key: string, value: ParameterValue | boolean): F;
    /**
     * Writes the refs the last evaluation actually matched back into the feature
     * (re-anchoring — see `ShapeTracking.resolvedProfiles`/`resolvedEdges`). Each
     * handler knows where its refs live; a feature whose entry is absent is
     * returned unchanged.
     */
    applyResolvedRefs?(
        feature: F,
        refs: {
            resolvedProfiles?: ProfileRef[];
            resolvedEdges?: (EdgeRef | undefined)[];
            resolvedTargets?: ResolvedEndTargets;
        },
    ): F;
}

const handlers = new Map<string, FeatureHandler>();

export function registerFeature(type: string, handler: FeatureHandler): void {
    handlers.set(type, handler);
}

export function featureHandler(type: string): FeatureHandler | undefined {
    return handlers.get(type);
}

export function evaluateFeature(feature: FeatureData, context: FeatureContext): Result<IShape> {
    const handler = handlers.get(feature.type);
    if (handler === undefined) return Result.err(`Unknown feature type: ${feature.type}`);
    return handler.evaluate(feature, context);
}

/**
 * Whether `feature.suppressBy` suppresses the feature under `scope` right now — the whole test, with
 * none of the bookkeeping a rebuild does around it (warning about a variable that will not resolve,
 * remembering which features a variable took out).
 *
 * `undefined` means the named variable is missing or not a finite number, and that suppresses
 * NOTHING: a typo'd name must never silently hide geometry, and the caller is the one that says so
 * (a rebuild warns, a preview has nothing to warn into).
 *
 * The distinction matters because a snapshot preview has to ask the SAME question the real run asks
 * (`evaluateChainSnapshot`) without writing the real run's records: reading only `feature.suppressed`
 * there left variable-suppressed features in the preview's chain, so the faces it offered to pick
 * were not the ones the chain would have.
 */
export function suppressionOf(feature: FeatureData, scope: Scope): boolean | undefined {
    const suppressBy = feature.suppressBy;
    if (suppressBy === undefined) return false;
    const value = scope.get(suppressBy.variable)?.value;
    if (value === undefined || !Number.isFinite(value)) return undefined;
    return suppressBy.invert === true ? value !== 0 : value === 0;
}
