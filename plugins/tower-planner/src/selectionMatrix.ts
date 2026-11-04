// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CraneEvaluation,
    evaluateCranes,
    type FindCranesOptions,
    type Pick,
    type PickEvaluation,
    type PickIssue,
} from "./pickEngine";
import type { CapacityModel } from "./types";

/**
 * Why a matrix cell is not a PASS. The evaluation issues are extended with the
 * two statuses that do not carry an `issue` of their own.
 */
export type SelectionReason = PickIssue | "over-capacity" | "out-of-range";

/**
 * The overall state of a catalogue comparison. These are deliberately distinct
 * so the UI cannot present "no mast position" or "invalid input" as a capacity
 * result.
 */
export type SelectionState =
    | "no-picks"
    | "invalid-picks"
    | "missing-mast"
    | "no-supported-cranes"
    | "no-crane-passes"
    | "cranes-pass";

export type SelectionMatrix = {
    /** One evaluation row per catalogue crane, in catalogue order. */
    rows: CraneEvaluation[];
    state: SelectionState;
    pickCount: number;
    craneCount: number;
    /** Cranes whose type is supported by this engine (trolley-jib). */
    evaluatedCraneCount: number;
    /** Cranes listed but not evaluated, currently luffing-jib entries. */
    unsupportedCraneCount: number;
    passingCraneCount: number;
    allPassCraneIds: string[];
    allPassCraneNames: string[];
    /** Picks rejected because of their own load/coordinate/wind values. */
    invalidPickCount: number;
    /** Coordinate picks that cannot be resolved because no mast was supplied. */
    missingMastPickCount: number;
};

/**
 * Issues caused by the pick input itself, as opposed to a crane's published
 * jib or capacity data. They are crane-independent, so the first row is enough
 * to classify the whole matrix. `invalid-mast` is tracked separately because it
 * describes a missing setup value, not bad pick data.
 */
const INPUT_ISSUES: ReadonlySet<PickIssue> = new Set<PickIssue>([
    "invalid-load",
    "invalid-wind",
    "invalid-coordinate",
    "missing-coordinate",
    "missing-location",
    "invalid-radius",
]);

/** A machine-readable explanation for a non-PASS cell. */
export function selectionReason(evaluation: PickEvaluation): SelectionReason | undefined {
    if (evaluation.status === "PASS") return undefined;
    if (evaluation.status === "FAIL") return "over-capacity";
    if (evaluation.status === "OUT_OF_RANGE") return "out-of-range";
    if (evaluation.status === "UNSUPPORTED") return "unsupported-crane-type";
    return evaluation.issue;
}

/**
 * Evaluate every catalogue crane against every pick and summarise the result.
 *
 * The rows come from the same `evaluateCrane`/`evaluatePick` engine used by the
 * single-crane check, so the matrix cannot apply a different capacity rule.
 * Each crane keeps its own `defaultJibM` unless the caller supplies an explicit
 * `jibM` or a `jibMByCrane` override; no jib or mast position is invented.
 *
 * A crane is only counted in `allPassCraneIds` when every pick passes. An empty
 * pick list is not a pass: it reports `no-picks` and no crane is marked as
 * suitable for the (empty) work. Luffing-jib entries are listed but reported as
 * unsupported; they are never counted as passing and do not inflate the
 * evaluated-crane denominator.
 */
export function buildSelectionMatrix(
    cranes: readonly CapacityModel[],
    picks: readonly Pick[],
    options: FindCranesOptions = {},
): SelectionMatrix {
    const rows = evaluateCranes(cranes, picks, options);
    const allPass = rows.filter((row) => row.allPass);
    const evaluatedCraneCount = rows.filter((row) => !row.unsupported).length;
    const unsupportedCraneCount = rows.length - evaluatedCraneCount;

    // Pick-level input issues are independent of the crane, so the first row
    // can classify them. With no cranes there is no evaluation to inspect.
    const inputIssues = rows[0]?.picks ?? [];
    const invalidPickCount = inputIssues.filter(
        (pick) => pick.issue !== undefined && pick.issue !== "invalid-mast" && INPUT_ISSUES.has(pick.issue),
    ).length;
    const missingMastPickCount = inputIssues.filter((pick) => pick.issue === "invalid-mast").length;

    let state: SelectionState;
    if (picks.length === 0) {
        state = "no-picks";
    } else if (invalidPickCount > 0) {
        state = "invalid-picks";
    } else if (missingMastPickCount > 0) {
        state = "missing-mast";
    } else if (evaluatedCraneCount === 0) {
        state = "no-supported-cranes";
    } else if (allPass.length > 0) {
        state = "cranes-pass";
    } else {
        state = "no-crane-passes";
    }

    return {
        rows,
        state,
        pickCount: picks.length,
        craneCount: cranes.length,
        evaluatedCraneCount,
        unsupportedCraneCount,
        passingCraneCount: allPass.length,
        allPassCraneIds: allPass.map((row) => row.craneId),
        allPassCraneNames: allPass.map((row) => row.craneName),
        invalidPickCount,
        missingMastPickCount,
    };
}
