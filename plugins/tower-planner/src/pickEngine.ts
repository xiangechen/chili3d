// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { capacityAt, publishedMaxJibM } from "./capacity";
import type { CapacityModel } from "./types";

/**
 * A horizontal site coordinate in metres. Supply, drop and mast must all use
 * the same site frame; the engine does not assume a particular origin.
 */
export type PickPoint = {
    x: number;
    y: number;
};

/**
 * One lift to check. `loadT` is the total suspended load in tonnes (the caller
 * should include rigging in this value). A pick may either name its supply and
 * drop points or carry a legacy hook radius; coordinates take precedence when
 * both are present. All engine calculations stay in metres and tonnes;
 * conversion to millimetres belongs at the Chili3D scene boundary, not here.
 */
export type Pick = {
    loadT: number;
    /** Horizontal pick-up (supply) point. */
    supply?: PickPoint;
    /** Horizontal set-down (drop) point. */
    drop?: PickPoint;
    /**
     * Legacy radius-only input, retained for callers that already know the hook
     * radius. Ignored when supply/drop coordinates are supplied.
     */
    radiusM?: number;
    label?: string;
    /**
     * Per-pick wind override. `undefined` falls back to the crane-level wind
     * setting; `null` explicitly disables the wind derate for this pick.
     */
    windKmh?: number | null;
};

/** Which input produced the governing hook radius. */
export type PickRadiusSource = "supply" | "drop" | "legacy";

export type PickRadiusIssue =
    | "missing-location"
    | "missing-coordinate"
    | "invalid-coordinate"
    | "invalid-mast"
    | "invalid-radius";

export type PickRadiusResolution =
    | {
          ok: true;
          radiusM: number;
          supplyRadiusM: number | null;
          dropRadiusM: number | null;
          governing: PickRadiusSource;
      }
    | {
          ok: false;
          issue: PickRadiusIssue;
      };

export type PickEvaluationOptions = {
    /** Installed jib length in metres. Defaults to the catalogue's `defaultJibM`. */
    jibM?: number;
    windKmh?: number | null;
    /**
     * Crane mast position. Required for supply/drop picks; legacy radius picks
     * ignore it. There is deliberately no default mast position.
     */
    mast?: PickPoint;
};

export type PickIssue =
    | PickRadiusIssue
    | "invalid-load"
    | "invalid-wind"
    | "jib-outside-published-range"
    | "invalid-capacity";

export type PickStatus = "PASS" | "FAIL" | "OUT_OF_RANGE" | "INVALID";

export type PickEvaluation = {
    craneId: string;
    craneName: string;
    label: string;
    jibM: number;
    loadT: number;
    /** Governing hook radius; null when the pick has no valid location. */
    radiusM: number | null;
    supplyRadiusM: number | null;
    dropRadiusM: number | null;
    governing: PickRadiusSource | null;
    windKmh: number | null;
    capacityT: number | null;
    utilisationPct: number | null;
    status: PickStatus;
    issue?: PickIssue;
};

export type CraneEvaluation = {
    craneId: string;
    craneName: string;
    jibM: number;
    windKmh: number | null;
    picks: PickEvaluation[];
    allPass: boolean;
    failedCount: number;
};

export type FindCranesOptions = PickEvaluationOptions & {
    /** Optional jib override keyed by crane id; useful when filtering a mixed fleet. */
    jibMByCrane?: Readonly<Record<string, number>>;
};

const JIB_TOLERANCE_M = 1e-9;
const CHART_JIB_TOLERANCE_M = 1e-6;

function isFinitePoint(point: PickPoint | undefined): point is PickPoint {
    return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function resolveCoordinateRadius(pick: Pick, mast: PickPoint | undefined): PickRadiusResolution {
    if (pick.supply === undefined || pick.drop === undefined) {
        return { ok: false, issue: "missing-coordinate" };
    }

    if (!isFinitePoint(pick.supply) || !isFinitePoint(pick.drop)) {
        return { ok: false, issue: "invalid-coordinate" };
    }

    if (!isFinitePoint(mast)) {
        return { ok: false, issue: "invalid-mast" };
    }

    const supplyRadiusM = Math.hypot(pick.supply.x - mast.x, pick.supply.y - mast.y);
    const dropRadiusM = Math.hypot(pick.drop.x - mast.x, pick.drop.y - mast.y);

    // `Math.hypot` can overflow to Infinity for enormous finite coordinates.
    if (!Number.isFinite(supplyRadiusM) || !Number.isFinite(dropRadiusM)) {
        return { ok: false, issue: "invalid-coordinate" };
    }

    // The larger radius governs the lift; a tie is reported as supply.
    const governing = dropRadiusM > supplyRadiusM ? "drop" : "supply";
    const radiusM = Math.max(supplyRadiusM, dropRadiusM);

    if (radiusM <= 0) {
        return { ok: false, issue: "invalid-radius" };
    }

    return { ok: true, radiusM, supplyRadiusM, dropRadiusM, governing };
}

/**
 * Resolve the hook radius for one pick.
 *
 * Supply/drop coordinates take precedence over a legacy `radiusM`. A coordinate
 * pick needs both points and a mast position; missing or non-finite values are
 * rejected instead of being replaced by zero or an assumed mast location.
 */
export function resolvePickRadius(pick: Pick, mast: PickPoint | undefined): PickRadiusResolution {
    if (pick.supply !== undefined || pick.drop !== undefined) {
        return resolveCoordinateRadius(pick, mast);
    }

    if (pick.radiusM === undefined) {
        return { ok: false, issue: "missing-location" };
    }

    if (!Number.isFinite(pick.radiusM) || pick.radiusM <= 0) {
        return { ok: false, issue: "invalid-radius" };
    }

    return {
        ok: true,
        radiusM: pick.radiusM,
        supplyRadiusM: null,
        dropRadiusM: null,
        governing: "legacy",
    };
}

function publishedJibRange(model: CapacityModel): { min: number; max: number } | undefined {
    const rows = model.tipLoadByJib;
    if (rows.length === 0) return undefined;

    const max = publishedMaxJibM(model);
    if (max === undefined) return undefined;

    return {
        min: rows[0].jibM.value,
        max,
    };
}

/**
 * A chart-based crane only has data for the jib lengths the manufacturer
 * published. Tip-load models keep the Cycle 2 range behaviour, which allows
 * interpolation between published rows.
 */
function isPublishedJib(model: CapacityModel, jibM: number): boolean {
    if (!Number.isFinite(jibM)) return false;

    if (model.loadChart !== undefined) {
        return model.loadChart.some((row) => Math.abs(row.jibM.value - jibM) <= CHART_JIB_TOLERANCE_M);
    }

    const range = publishedJibRange(model);
    if (!range) return false;
    return jibM >= range.min - JIB_TOLERANCE_M && jibM <= range.max + JIB_TOLERANCE_M;
}

/**
 * Check one pick against one crane. The engine is UI-independent: it returns
 * data only, and the caller decides how to label PASS/FAIL.
 */
export function evaluatePick(
    crane: CapacityModel,
    pick: Pick,
    options: PickEvaluationOptions = {},
): PickEvaluation {
    const jibM = options.jibM ?? crane.defaultJibM.value;
    const windKmh = pick.windKmh !== undefined ? pick.windKmh : (options.windKmh ?? null);
    const resolution = resolvePickRadius(pick, options.mast);

    const base = {
        craneId: crane.id,
        craneName: crane.name,
        label: pick.label ?? "",
        jibM,
        loadT: pick.loadT,
        radiusM: resolution.ok ? resolution.radiusM : null,
        supplyRadiusM: resolution.ok ? resolution.supplyRadiusM : null,
        dropRadiusM: resolution.ok ? resolution.dropRadiusM : null,
        governing: resolution.ok ? resolution.governing : null,
        windKmh,
    } as const;

    if (!Number.isFinite(pick.loadT) || pick.loadT <= 0) {
        return {
            ...base,
            capacityT: null,
            utilisationPct: null,
            status: "INVALID",
            issue: "invalid-load",
        };
    }

    if (!resolution.ok) {
        return {
            ...base,
            capacityT: null,
            utilisationPct: null,
            status: "INVALID",
            issue: resolution.issue,
        };
    }

    // `null`/`undefined` means "no wind derate"; any supplied wind value must
    // be a finite, non-negative number. Rejecting it here gives the caller a
    // specific issue instead of silently treating bad input as calm weather.
    if (windKmh !== null && (!Number.isFinite(windKmh) || windKmh < 0)) {
        return {
            ...base,
            capacityT: null,
            utilisationPct: null,
            status: "INVALID",
            issue: "invalid-wind",
        };
    }

    if (!isPublishedJib(crane, jibM)) {
        return {
            ...base,
            capacityT: null,
            utilisationPct: null,
            status: "INVALID",
            issue: "jib-outside-published-range",
        };
    }

    const capacityT = capacityAt(crane, jibM, resolution.radiusM, windKmh);

    if (capacityT === null) {
        return {
            ...base,
            capacityT: null,
            utilisationPct: null,
            status: "OUT_OF_RANGE",
        };
    }

    if (!Number.isFinite(capacityT) || capacityT <= 0) {
        return {
            ...base,
            capacityT: null,
            utilisationPct: null,
            status: "INVALID",
            issue: "invalid-capacity",
        };
    }

    const utilisationPct = (pick.loadT / capacityT) * 100;

    return {
        ...base,
        capacityT,
        utilisationPct,
        status: pick.loadT <= capacityT ? "PASS" : "FAIL",
    };
}

/**
 * Evaluate a pick list against one crane. An empty pick list is not treated as
 * "everything passes": `allPass` is false because the analysis has no evidence.
 */
export function evaluateCrane(
    crane: CapacityModel,
    picks: readonly Pick[],
    options: PickEvaluationOptions = {},
): CraneEvaluation {
    const jibM = options.jibM ?? crane.defaultJibM.value;
    const evaluations = picks.map((pick) =>
        evaluatePick(crane, pick, { jibM, windKmh: options.windKmh, mast: options.mast }),
    );
    const failedCount = evaluations.filter((evaluation) => evaluation.status !== "PASS").length;

    return {
        craneId: crane.id,
        craneName: crane.name,
        jibM,
        windKmh: options.windKmh ?? null,
        picks: evaluations,
        allPass: evaluations.length > 0 && failedCount === 0,
        failedCount,
    };
}

/**
 * Evaluate a pick list against every crane, applying any per-crane jib
 * override. This is the shared row builder for catalogue-wide views: the
 * selection matrix and `findCranesPassingAllPicks` both use it, so they cannot
 * disagree about which cranes pass.
 */
export function evaluateCranes(
    cranes: readonly CapacityModel[],
    picks: readonly Pick[],
    options: FindCranesOptions = {},
): CraneEvaluation[] {
    return cranes.map((crane) =>
        evaluateCrane(crane, picks, {
            jibM: options.jibMByCrane?.[crane.id] ?? options.jibM,
            windKmh: options.windKmh,
            mast: options.mast,
        }),
    );
}

/**
 * Return the crane evaluations for which every pick passes. This is deliberately
 * generic over `CapacityModel`, so a future sourced crane can be added to the
 * catalogue without changing the filtering code.
 */
export function findCranesPassingAllPicks(
    cranes: readonly CapacityModel[],
    picks: readonly Pick[],
    options: FindCranesOptions = {},
): CraneEvaluation[] {
    return evaluateCranes(cranes, picks, options).filter((evaluation) => evaluation.allPass);
}
