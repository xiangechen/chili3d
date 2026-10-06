// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CurvePiece } from "./curveGeometry";

/**
 * What a pick previews, as the op that would do it describes it and the editor draws it.
 * The ops answer in these terms rather than in meshes so that the decision and its drawing
 * stay apart — the same reason a trim hands back a piece and not a triangle list.
 */

/**
 * One piece of a preview with what the click would do to it: "remove" for the piece the op
 * takes away, "add" for the one it lays down. The two are drawn in different tones, because
 * an extend that cuts back and one that grows would otherwise look exactly alike.
 */
export interface PreviewPiece {
    readonly piece: CurvePiece;
    readonly role: "remove" | "add";
}

/**
 * What an entity-and-position pick would leave at the click: the pieces of a curve it would
 * change, or the points it would carve at. It is the op's own answer — `trimPreview`,
 * `extendPreview` and `breakPreview` all speak it — so a pick that would refuse draws
 * nothing, and the refusal reads before the click rather than after it.
 */
export type SketchCurvePreview =
    | { readonly kind: "pieces"; readonly pieces: readonly PreviewPiece[] }
    | { readonly kind: "markers"; readonly uvs: readonly [number, number][] };

/**
 * Live preview for an entity-and-position pick: handed the entity under the cursor and
 * where on it the click sits, both in sketch terms. Undefined when the pointer is off every
 * entity, or the op would refuse there.
 */
export type SketchPreviewAt = (entityId: number, uv: [number, number]) => SketchCurvePreview | undefined;
