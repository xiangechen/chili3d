// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CapacityModel, JibLoadChart } from "./types";

/**
 * Round 3 asked for a 0.8 capacity factor at 20 km/h, described as "per
 * EN 14439 Table 7". The project sources do not contain that table text or the
 * factor, so this is deliberately labelled SIMULATED and is not claimed to be a
 * manufacturer or standards rule. It is not a certified wind-load calculation.
 */
export const WIND_DERATE_RULE = {
    provenance: "SIMULATED",
    thresholdKmh: 20,
    factor: 0.8,
    note: "SIMULATED product rule: at or above 20 km/h multiply the base rated capacity by 0.8. Not verified against EN 14439 Table 7 and not a certified wind-load calculation.",
} as const;

/**
 * Cycle 2 `tipLoadAt`: linear interpolation between published jib/tip rows,
 * clamped to the first/last row outside the table. The interpolation is a
 * project convenience; the published rows themselves remain the source.
 *
 * This is a table helper, not a configuration check: it has no way to signal
 * that a jib length is unpublished, so it clamps rather than returning an
 * invalid value. `capacityAt` applies the published maximum and returns `null`
 * above it; callers that need validity must use that function.
 */
export function tipLoadAt(model: CapacityModel, jibM: number): number {
    if (!Number.isFinite(jibM)) {
        throw new RangeError(`Jib length must be finite, received ${jibM}.`);
    }

    const rows = model.tipLoadByJib;
    if (rows.length === 0) {
        throw new RangeError(`Crane "${model.id}" has no tip-load rows.`);
    }

    if (jibM <= rows[0].jibM.value) {
        return rows[0].tipT.value;
    }

    const last = rows[rows.length - 1];
    if (jibM >= last.jibM.value) {
        return last.tipT.value;
    }

    for (let index = 0; index < rows.length - 1; index++) {
        const a = rows[index];
        const b = rows[index + 1];
        if (jibM >= a.jibM.value && jibM <= b.jibM.value) {
            const fraction = (jibM - a.jibM.value) / (b.jibM.value - a.jibM.value);
            return a.tipT.value + fraction * (b.tipT.value - a.tipT.value);
        }
    }

    return last.tipT.value;
}

/** Rated load moment for an installed jib: tip load × jib length, in t·m. */
export function momentAt(model: CapacityModel, jibM: number): number {
    return tipLoadAt(model, jibM) * jibM;
}

/** Radius at which the two-piece curve leaves the flat maximum-capacity region. */
export function cornerRadiusAt(model: CapacityModel, jibM: number): number {
    const maxCapacityT = model.maxCapacityT.value;
    if (!Number.isFinite(maxCapacityT) || maxCapacityT <= 0) {
        throw new RangeError(`Crane "${model.id}" has an invalid maximum capacity.`);
    }
    return momentAt(model, jibM) / maxCapacityT;
}

const CHART_JIB_TOLERANCE_M = 1e-6;
const MAX_JIB_TOLERANCE_M = 1e-9;

/**
 * Longest jib the model publishes capacity data for. A `TowerCrane` declares
 * `maxJibLengthM`; a narrow test fixture may omit it, in which case the longest
 * load-chart row or the last tip-load row is the data limit. The smaller of the
 * declared maximum and the available data wins: a catalogue declaration must
 * never let the engine clamp a longer, unpublished jib to the last row.
 */
export function publishedMaxJibM(model: CapacityModel): number | undefined {
    let dataMaxM: number | undefined;

    if (model.loadChart !== undefined && model.loadChart.length > 0) {
        dataMaxM = model.loadChart.reduce(
            (max, row) => (row.jibM.value > max ? row.jibM.value : max),
            Number.NEGATIVE_INFINITY,
        );
    } else if (model.tipLoadByJib.length > 0) {
        dataMaxM = model.tipLoadByJib[model.tipLoadByJib.length - 1].jibM.value;
    }

    if (dataMaxM !== undefined && !Number.isFinite(dataMaxM)) return undefined;

    const declaredM = model.maxJibLengthM?.value;
    if (declaredM === undefined) return dataMaxM;
    if (!Number.isFinite(declaredM) || declaredM <= 0) return undefined;
    if (dataMaxM === undefined) return declaredM;

    return Math.min(declaredM, dataMaxM);
}

function findJibChart(model: CapacityModel, jibM: number): JibLoadChart | undefined {
    return model.loadChart?.find((row) => Math.abs(row.jibM.value - jibM) <= CHART_JIB_TOLERANCE_M);
}

/**
 * Read one point from a manufacturer's per-radius chart.
 *
 * The published curve is monotonic non-increasing. Between two published radii
 * this returns the capacity at the next (larger) radius, i.e. the lower of the
 * two bounding values. That is deliberately conservative: it cannot overstate
 * the manufacturer's capacity, though it may understate it between points.
 * There is no extrapolation beyond the last published radius, no chart is
 * invented for a jib length the document does not publish, and a radius below
 * the published minimum returns `null` instead of the flat plateau. The minimum
 * is stored separately because the first point marks the end of the plateau,
 * not the smallest published radius.
 */
function chartCapacityAt(chart: JibLoadChart, radiusM: number): number | null {
    const points = chart.points;
    if (points.length === 0) return null;

    const minRadiusM = chart.minRadiusM.value;
    if (!Number.isFinite(minRadiusM) || minRadiusM <= 0) return null;
    if (radiusM < minRadiusM - 1e-9) return null;

    if (radiusM <= points[0].radiusM.value) {
        return points[0].capacityT.value;
    }

    const last = points[points.length - 1];
    if (radiusM > last.radiusM.value + 1e-9) {
        return null;
    }

    for (let index = 0; index < points.length - 1; index++) {
        const lower = points[index];
        const upper = points[index + 1];
        if (radiusM <= upper.radiusM.value + 1e-9) {
            return Math.min(lower.capacityT.value, upper.capacityT.value);
        }
    }

    return last.capacityT.value;
}

/**
 * Cycle 2 `capacityAt` behaviour preserved for valid inputs on tip-load models:
 *   radius > jib              -> null
 *   radius <= 0               -> maximum capacity
 *   radius <= corner radius   -> maximum capacity
 *   radius >  corner radius   -> moment / radius
 * When a model carries a `loadChart`, the chart is used instead and the
 * requested jib must be one of its published configurations. Optional wind
 * derating is applied once to the final base capacity and is labelled SIMULATED
 * (see `WIND_DERATE_RULE`). `null`/`undefined` wind means no derate; negative or
 * non-finite wind is invalid and returns `null`. Invalid/non-finite geometry
 * also returns null instead of a NaN, so callers cannot accidentally render a
 * numeric capacity. A jib above the model's published maximum (or above its
 * last published tip-load/chart row) returns `null` before any interpolation.
 * A model marked `craneType: "luffing-jib"` returns `null` immediately: the
 * trolley-jib rules below do not describe luffing geometry.
 */
export function capacityAt(
    model: CapacityModel,
    jibM: number,
    radiusM: number,
    windKmh?: number | null,
): number | null {
    // Luffing-jib geometry (variable radius at a fixed luff angle) is not the
    // trolley-jib model this engine implements. Refuse rather than returning a
    // plausible but wrong capacity.
    if (model.craneType === "luffing-jib") return null;

    if (!Number.isFinite(jibM) || jibM <= 0) return null;

    const maxJibM = publishedMaxJibM(model);
    if (maxJibM === undefined || jibM > maxJibM + MAX_JIB_TOLERANCE_M) return null;

    if (!Number.isFinite(radiusM)) return null;
    if (radiusM > jibM) return null;
    if (model.tipLoadByJib.length === 0) return null;

    const maxCapacityT = model.maxCapacityT.value;
    if (!Number.isFinite(maxCapacityT) || maxCapacityT <= 0) return null;

    let base: number;
    if (model.loadChart !== undefined) {
        if (model.loadChart.length === 0) return null;
        const chart = findJibChart(model, jibM);
        if (!chart) return null;
        const chartCapacity = chartCapacityAt(chart, radiusM);
        if (chartCapacity === null) return null;
        base = chartCapacity;
    } else if (radiusM <= 0) {
        base = maxCapacityT;
    } else {
        const moment = momentAt(model, jibM);
        const cornerRadius = moment / maxCapacityT;
        base = radiusM <= cornerRadius ? maxCapacityT : moment / radiusM;
    }

    if (windKmh === undefined || windKmh === null) return base;

    const wind = Number(windKmh);
    if (!Number.isFinite(wind) || wind < 0) return null;

    return wind >= WIND_DERATE_RULE.thresholdKmh ? base * WIND_DERATE_RULE.factor : base;
}
