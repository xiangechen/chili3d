// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CranePointM } from "./craneModel";

export const PLANNING_DISCLAIMER = "Planning aid, not a certified lift plan." as const;

/** Standard gravity: a mass of 1 tonne weighs 9.80665 kN. Used to convert t/m2 to kPa. */
const STANDARD_GRAVITY = 9.80665;

export type OutriggerId = "frontLeft" | "frontRight" | "rearLeft" | "rearRight";

export type OutriggerPad = {
    readonly id: OutriggerId;
    readonly label: string;
    readonly positionM: CranePointM;
    readonly reactionT: number;
};

/**
 * Direct outrigger reaction calculation input.
 * All dimensions are in metres; weight is in metric tonnes.
 * No crane numbers are hardcoded; all parameters are user inputs.
 */
export type OutriggerReactionsInput = {
    /** Total machine + load weight W in metric tonnes (user input). */
    readonly totalWeightT: number;
    /** Longitudinal spread L between front and rear pad centres in metres (user input). */
    readonly lengthSpreadM: number;
    /** Transverse spread B between left and right pad centres in metres (user input). */
    readonly widthSpreadM: number;
    /** Resultant center-of-gravity offset along longitudinal (X) axis in metres (default: 0). */
    readonly eccentricityXM?: number;
    /** Resultant center-of-gravity offset along transverse (Y) axis in metres (default: 0). */
    readonly eccentricityYM?: number;
};

/**
 * Lift-based outrigger reaction calculation input.
 * Converts crane weight, lifted load, radius, and slew angle to resultant eccentricity.
 */
export type CraneLiftReactionsInput = {
    /** Crane carrier + superstructure + counterweight in tonnes (user input). */
    readonly craneWeightT: number;
    /** Total suspended load (payload + hook block + rigging) in tonnes (user input). */
    readonly liftedLoadT: number;
    /** Operating radius from crane slew center in metres. */
    readonly radiusM: number;
    /** Slew angle in degrees (0 = front / +X, 90 = left / +Y, 180 = rear / -X, 270 = right / -Y). */
    readonly slewAngleDeg: number;
    /** Longitudinal outrigger spread in metres. */
    readonly lengthSpreadM: number;
    /** Transverse outrigger spread in metres. */
    readonly widthSpreadM: number;
    /** Center of gravity of unladen crane relative to slew center (default: { xM: 0, yM: 0 }). */
    readonly craneCgOffsetM?: CranePointM;
};

export type PadReactionsResult = {
    readonly totalWeightT: number;
    readonly lengthSpreadM: number;
    readonly widthSpreadM: number;
    readonly eccentricityXM: number;
    readonly eccentricityYM: number;
    readonly reactions: {
        readonly frontLeft: OutriggerPad;
        readonly frontRight: OutriggerPad;
        readonly rearLeft: OutriggerPad;
        readonly rearRight: OutriggerPad;
    };
    readonly maxReactionT: number;
    readonly minReactionT: number;
    readonly isStable: boolean;
    readonly disclaimer: typeof PLANNING_DISCLAIMER;
};

export type OutriggerFootprint = {
    readonly lengthSpreadM: number;
    readonly widthSpreadM: number;
    readonly pads: {
        readonly frontLeft: CranePointM;
        readonly frontRight: CranePointM;
        readonly rearRight: CranePointM;
        readonly rearLeft: CranePointM;
    };
    /** Closed 4-point polygon around pad centres in CCW order (FL -> RL -> RR -> FR). */
    readonly polygon: readonly CranePointM[];
};

/** PASS or FAIL only against a user allowable; NOT_CHECKED when no allowable was given. */
export type GroundBearingStatus = "PASS" | "FAIL" | "NOT_CHECKED";

export type GroundBearingResult = {
    readonly reactionT: number;
    readonly padAreaM2: number;
    readonly pressureT_M2: number;
    readonly pressureKPa: number;
    readonly allowableBearingCapacityT_M2?: number;
    readonly isAllowableExceeded?: boolean;
    readonly status: GroundBearingStatus;
    readonly disclaimer: typeof PLANNING_DISCLAIMER;
};

function assertFiniteNumber(value: number, paramName: string): void {
    if (!Number.isFinite(value)) {
        throw new Error(`${paramName} must be a finite number`);
    }
}

function assertPositiveNumber(value: number, paramName: string): void {
    assertFiniteNumber(value, paramName);
    if (value <= 0) {
        throw new Error(`${paramName} must be strictly greater than 0`);
    }
}

/**
 * Calculates outrigger reactions for a 4-pad mobile crane base.
 *
 * Equilibrium formulation:
 * - Pad coordinates: FL(+L/2, +B/2), FR(+L/2, -B/2), RL(-L/2, +B/2), RR(-L/2, -B/2).
 * - Reaction on pad i: R_i = W * (1/4 + (x_i * e_x) / L^2 + (y_i * e_y) / B^2)
 *   which simplifies to:
 *     R_i = W/4 ± W*e_x/(2L) ± W*e_y/(2B)
 *
 * For a centered load (e_x = 0, e_y = 0), this yields R_i = W / 4 on each pad.
 * For an offset load, moments about longitudinal and transverse axes are exactly satisfied.
 */
export function calculatePadReactions(input: OutriggerReactionsInput): PadReactionsResult {
    assertPositiveNumber(input.totalWeightT, "totalWeightT");
    assertPositiveNumber(input.lengthSpreadM, "lengthSpreadM");
    assertPositiveNumber(input.widthSpreadM, "widthSpreadM");

    const eX = input.eccentricityXM ?? 0;
    const eY = input.eccentricityYM ?? 0;
    assertFiniteNumber(eX, "eccentricityXM");
    assertFiniteNumber(eY, "eccentricityYM");

    const W = input.totalWeightT;
    const L = input.lengthSpreadM;
    const B = input.widthSpreadM;

    const baseReaction = W / 4;
    const deltaLongitudinal = (W * eX) / (2 * L);
    const deltaTransverse = (W * eY) / (2 * B);

    const rFL = baseReaction + deltaLongitudinal + deltaTransverse;
    const rFR = baseReaction + deltaLongitudinal - deltaTransverse;
    const rRL = baseReaction - deltaLongitudinal + deltaTransverse;
    const rRR = baseReaction - deltaLongitudinal - deltaTransverse;

    const halfL = L / 2;
    const halfB = B / 2;

    const frontLeft: OutriggerPad = {
        id: "frontLeft",
        label: "Front Left (FL)",
        positionM: { xM: halfL, yM: halfB },
        reactionT: rFL,
    };
    const frontRight: OutriggerPad = {
        id: "frontRight",
        label: "Front Right (FR)",
        positionM: { xM: halfL, yM: -halfB },
        reactionT: rFR,
    };
    const rearLeft: OutriggerPad = {
        id: "rearLeft",
        label: "Rear Left (RL)",
        positionM: { xM: -halfL, yM: halfB },
        reactionT: rRL,
    };
    const rearRight: OutriggerPad = {
        id: "rearRight",
        label: "Rear Right (RR)",
        positionM: { xM: -halfL, yM: -halfB },
        reactionT: rRR,
    };

    const reactions = [rFL, rFR, rRL, rRR];
    const maxReactionT = Math.max(...reactions);
    const minReactionT = Math.min(...reactions);
    const isStable = minReactionT >= 0;

    return {
        totalWeightT: W,
        lengthSpreadM: L,
        widthSpreadM: B,
        eccentricityXM: eX,
        eccentricityYM: eY,
        reactions: {
            frontLeft,
            frontRight,
            rearLeft,
            rearRight,
        },
        maxReactionT,
        minReactionT,
        isStable,
        disclaimer: PLANNING_DISCLAIMER,
    };
}

/**
 * Calculates outrigger reactions from crane empty weight and a lifted load at a given radius and slew angle.
 */
export function calculatePadReactionsFromLift(input: CraneLiftReactionsInput): PadReactionsResult {
    assertPositiveNumber(input.craneWeightT, "craneWeightT");
    assertFiniteNumber(input.liftedLoadT, "liftedLoadT");
    if (input.liftedLoadT < 0) {
        throw new Error("liftedLoadT must be non-negative");
    }
    assertFiniteNumber(input.radiusM, "radiusM");
    if (input.radiusM < 0) {
        throw new Error("radiusM must be non-negative");
    }
    assertFiniteNumber(input.slewAngleDeg, "slewAngleDeg");

    const totalWeightT = input.craneWeightT + input.liftedLoadT;
    const angleRad = (input.slewAngleDeg * Math.PI) / 180;
    const loadXM = input.radiusM * Math.cos(angleRad);
    const loadYM = input.radiusM * Math.sin(angleRad);

    // NOTE: Crane CG offset assumed fixed; real crane CG moves with boom angle/slew.
    // With the default offset of 0 the counterweight CG is assumed at the slew centre
    // (its mass is included in craneWeightT), and the slew centre is taken as
    // the centre of the 4 pads. INDICATIVE simplification.
    const craneCgX = input.craneCgOffsetM?.xM ?? 0;
    const craneCgY = input.craneCgOffsetM?.yM ?? 0;
    assertFiniteNumber(craneCgX, "craneCgOffsetM.xM");
    assertFiniteNumber(craneCgY, "craneCgOffsetM.yM");

    const eccentricityXM = (input.craneWeightT * craneCgX + input.liftedLoadT * loadXM) / totalWeightT;
    const eccentricityYM = (input.craneWeightT * craneCgY + input.liftedLoadT * loadYM) / totalWeightT;

    return calculatePadReactions({
        totalWeightT,
        lengthSpreadM: input.lengthSpreadM,
        widthSpreadM: input.widthSpreadM,
        eccentricityXM,
        eccentricityYM,
    });
}

/**
 * Generates the outrigger footprint polygon coordinates on the site plan in metres.
 * Supports optional translation and rotation (heading).
 */
export function getOutriggerFootprint(options: {
    readonly lengthSpreadM: number;
    readonly widthSpreadM: number;
    readonly center?: CranePointM;
    readonly headingRad?: number;
}): OutriggerFootprint {
    assertPositiveNumber(options.lengthSpreadM, "lengthSpreadM");
    assertPositiveNumber(options.widthSpreadM, "widthSpreadM");

    const halfL = options.lengthSpreadM / 2;
    const halfB = options.widthSpreadM / 2;
    const cx = options.center?.xM ?? 0;
    const cy = options.center?.yM ?? 0;
    const theta = options.headingRad ?? 0;

    const transform = (localX: number, localY: number): CranePointM => {
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return {
            xM: cx + (localX * cos - localY * sin),
            yM: cy + (localX * sin + localY * cos),
        };
    };

    const frontLeft = transform(halfL, halfB);
    const frontRight = transform(halfL, -halfB);
    const rearRight = transform(-halfL, -halfB);
    const rearLeft = transform(-halfL, halfB);

    return {
        lengthSpreadM: options.lengthSpreadM,
        widthSpreadM: options.widthSpreadM,
        pads: {
            frontLeft,
            frontRight,
            rearRight,
            rearLeft,
        },
        polygon: [frontLeft, rearLeft, rearRight, frontRight],
    };
}

/**
 * Calculates ground bearing pressure for a single outrigger pad (supports M4).
 * Standard gravity factor g = 9.80665 kN/tonne.
 */
export function calculateGroundBearing(
    reactionT: number,
    padAreaM2: number,
    allowableBearingCapacityT_M2?: number,
): GroundBearingResult {
    assertFiniteNumber(reactionT, "reactionT");
    assertPositiveNumber(padAreaM2, "padAreaM2");

    const pressureT_M2 = reactionT / padAreaM2;
    const pressureKPa = pressureT_M2 * STANDARD_GRAVITY;

    // A negative reaction means the pad has lifted off the ground: never PASS (fail-safe).
    const padUplifted = reactionT < 0;
    let isAllowableExceeded: boolean | undefined;
    // Without a user allowable there is nothing to check against, so it is not a PASS.
    let status: GroundBearingStatus = padUplifted ? "FAIL" : "NOT_CHECKED";

    if (allowableBearingCapacityT_M2 !== undefined) {
        assertPositiveNumber(allowableBearingCapacityT_M2, "allowableBearingCapacityT_M2");
        isAllowableExceeded = pressureT_M2 > allowableBearingCapacityT_M2;
        status = padUplifted || isAllowableExceeded ? "FAIL" : "PASS";
    }

    return {
        reactionT,
        padAreaM2,
        pressureT_M2,
        pressureKPa,
        allowableBearingCapacityT_M2,
        isAllowableExceeded,
        status,
        disclaimer: PLANNING_DISCLAIMER,
    };
}

/**
 * Formats a text summary of outrigger pad reactions suitable for UI panels or reports.
 */
export function formatOutriggerSummary(result: PadReactionsResult): string {
    const stabilityText = result.isStable
        ? "STABLE (all pads in compression)"
        : "UNSTABLE / TIPPING (pad uplift detected)";
    return (
        `Outrigger Reactions (W = ${result.totalWeightT.toFixed(1)} t, spread = ${result.lengthSpreadM.toFixed(1)} m x ${result.widthSpreadM.toFixed(1)} m):\n` +
        `  FL: ${result.reactions.frontLeft.reactionT.toFixed(2)} t\n` +
        `  FR: ${result.reactions.frontRight.reactionT.toFixed(2)} t\n` +
        `  RL: ${result.reactions.rearLeft.reactionT.toFixed(2)} t\n` +
        `  RR: ${result.reactions.rearRight.reactionT.toFixed(2)} t\n` +
        `  Peak reaction: ${result.maxReactionT.toFixed(2)} t | Min reaction: ${result.minReactionT.toFixed(2)} t\n` +
        `  Status: ${stabilityText}\n` +
        `${result.disclaimer}`
    );
}
