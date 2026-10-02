// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The bodies a join/cut/intersect feature can combine with, as the command panel shows them:
 * an id to store and a label to read. A plain pair rather than the node itself, so the
 * control knows nothing about the document.
 */
export interface TargetCandidate {
    readonly id: string;
    readonly label: string;
}

/**
 * Which bodies the feature combines with. `auto` is true while the command's own detection
 * owns the checked set — the tool's bounding box is only known once the picks are in, so the
 * set is filled (and refilled) by the detection until the user edits it, and the first edit
 * freezes it. Empty with `auto` false means the user chose no body at all: the feature stands
 * alone, which is also what an empty detection means.
 */
export interface TargetSelection {
    readonly auto: boolean;
    readonly ids: readonly string[];
}

export const AUTO_TARGETS: TargetSelection = Object.freeze({ auto: true, ids: [] });

/**
 * A command whose feature can combine with several bodies. The control reaches the command
 * through this rather than through its concrete class, so it can live in `element` (which
 * knows nothing about parametric bodies or the document).
 */
export interface ITargetProvider {
    targetCandidates(): readonly TargetCandidate[];
    setTargets(selection: TargetSelection): void;
}

export function isTargetProvider(obj: unknown): obj is ITargetProvider {
    return (
        typeof obj === "object" &&
        obj !== null &&
        typeof (obj as ITargetProvider).targetCandidates === "function" &&
        typeof (obj as ITargetProvider).setTargets === "function"
    );
}
