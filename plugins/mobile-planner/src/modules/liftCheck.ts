// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CranePointM } from "./craneModel";
import { capacityAt, KIT, radiusFromPoint } from "./craneModel";

export type LiftCheckInput = {
    readonly cranePosition: CranePointM;
    readonly pickPoint: CranePointM;
    readonly setPoint: CranePointM;
    readonly loadWeightT: number;
    readonly riggingWeightT: number;
    readonly boomLengthM: number;
};

export type LiftCheckStatus = "PASS" | "FAIL" | "UNSUPPORTED";

export type LiftCheckResult = {
    readonly status: LiftCheckStatus;
    readonly craneName: typeof KIT.name;
    readonly pickRadiusM: number;
    readonly setRadiusM: number;
    readonly requiredRadiusM: number;
    readonly worstRadiusPoint: "pick" | "set";
    readonly boomLengthM: number;
    readonly totalLoadT: number;
    readonly capacityT: number | null;
    readonly utilisationPct: number | null;
    readonly disclaimer: "Planning aid, not a certified lift plan.";
};

function assertFiniteNumber(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number`);
    }
}

function assertNonNegativeNumber(value: number, name: string): void {
    assertFiniteNumber(value, name);
    if (value < 0) {
        throw new Error(`${name} must be non-negative`);
    }
}

function assertPoint(point: CranePointM, name: string): void {
    if (point === null || typeof point !== "object") {
        throw new Error(`${name} must be a point`);
    }
    assertFiniteNumber(point.xM, `${name}.xM`);
    assertFiniteNumber(point.yM, `${name}.yM`);
}

/**
 * Checks a mobile-crane lift at both ends of its swing.
 *
 * The KIT chart is an exact lookup table. A radius or boom length not published
 * in that table is unsupported rather than interpolated.
 */
export function calculateLiftCheck(input: LiftCheckInput): LiftCheckResult {
    if (input === null || typeof input !== "object") {
        throw new Error("input must be an object");
    }

    assertPoint(input.cranePosition, "cranePosition");
    assertPoint(input.pickPoint, "pickPoint");
    assertPoint(input.setPoint, "setPoint");
    assertNonNegativeNumber(input.loadWeightT, "loadWeightT");
    assertNonNegativeNumber(input.riggingWeightT, "riggingWeightT");
    assertNonNegativeNumber(input.boomLengthM, "boomLengthM");

    const pickRadiusM = radiusFromPoint({
        xM: input.pickPoint.xM - input.cranePosition.xM,
        yM: input.pickPoint.yM - input.cranePosition.yM,
    });
    const setRadiusM = radiusFromPoint({
        xM: input.setPoint.xM - input.cranePosition.xM,
        yM: input.setPoint.yM - input.cranePosition.yM,
    });
    const requiredRadiusM = Math.max(pickRadiusM, setRadiusM);
    const worstRadiusPoint = pickRadiusM >= setRadiusM ? "pick" : "set";
    const totalLoadT = input.loadWeightT + input.riggingWeightT;
    assertFiniteNumber(totalLoadT, "totalLoadT");
    const capacityT = capacityAt(input.boomLengthM, requiredRadiusM);
    const utilisationPct = capacityT === null ? null : (totalLoadT / capacityT) * 100;

    return {
        status: capacityT === null ? "UNSUPPORTED" : totalLoadT <= capacityT ? "PASS" : "FAIL",
        craneName: KIT.name,
        pickRadiusM,
        setRadiusM,
        requiredRadiusM,
        worstRadiusPoint,
        boomLengthM: input.boomLengthM,
        totalLoadT,
        capacityT,
        utilisationPct,
        disclaimer: "Planning aid, not a certified lift plan.",
    };
}
