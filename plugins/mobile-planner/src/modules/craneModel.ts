// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type CranePointM = {
    xM: number;
    yM: number;
};

export type ChartCell = {
    readonly boomLengthM: number;
    readonly radiusM: number;
    readonly capacityT: number;
};

const boomLengthsM = [13.3, 23.6, 38, 52.4, 70] as const;
const radiiM = [5, 8, 10, 11, 12, 15, 20, 30] as const;
const capacityT = [
    [121, 84.5, 64.5, null, null, null, null, null],
    [111, 83.5, 68, 62, 57, 45, 27, null],
    [59, 58.5, 53, 50.5, 47.5, 40, 30.5, 17.2],
    [null, null, 31, 31, 31, 28.5, 23.5, 15],
    [null, null, null, null, 14.5, 14.5, 14.5, 12.1],
] as const;

const chart = Object.freeze(
    boomLengthsM.flatMap((boomLength, boomIndex) =>
        radiiM.flatMap((radius, radiusIndex) => {
            const capacity = capacityT[boomIndex][radiusIndex];
            return capacity === null
                ? []
                : [Object.freeze({ boomLengthM: boomLength, radiusM: radius, capacityT: capacity })];
        }),
    ),
) satisfies readonly ChartCell[];

export const KIT = Object.freeze({
    name: "Grove GMK5250L-1",
    PIVOT_OFFSET_M: 0.8,
    chart,
    source: Object.freeze({
        document: "Grove GMK5250L-1 load chart, page 17",
        title: "2025-02-11_KB_MTW_PG_GMK5250L-1_V2.indd",
        craneModel: "Grove GMK5250L-1",
        url: "https://www.manitowoc.com/media/15016/download",
        page: 17,
        revision: "2025-02-11 / V2",
        status: "VERIFIED",
    }),
});

function assertFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new Error(`${name} must be finite`);
    }
}

export function radiusFromPoint(point: CranePointM): number {
    assertFinite(point.xM, "point.xM");
    assertFinite(point.yM, "point.yM");
    return Math.hypot(point.xM, point.yM) + KIT.PIVOT_OFFSET_M;
}

export function expectedRadiusM(boomLengthM: number, angleDeg: number): number {
    assertFinite(boomLengthM, "boomLengthM");
    assertFinite(angleDeg, "angleDeg");
    if (boomLengthM < 0) {
        throw new Error("boomLengthM must be non-negative");
    }
    if (angleDeg < 0 || angleDeg > 90) {
        throw new Error("angleDeg must be between 0 and 90 degrees");
    }
    return boomLengthM * Math.cos((angleDeg * Math.PI) / 180) + KIT.PIVOT_OFFSET_M;
}

export function capacityAt(boomLengthM: number, radiusM: number): number | null {
    assertFinite(boomLengthM, "boomLengthM");
    assertFinite(radiusM, "radiusM");
    if (boomLengthM < 0 || radiusM < 0) {
        throw new Error("boomLengthM and radiusM must be non-negative");
    }

    const cell = chart.find(
        ({ boomLengthM: chartBoomLengthM, radiusM: chartRadiusM }) =>
            chartBoomLengthM === boomLengthM && chartRadiusM === radiusM,
    );
    return cell?.capacityT ?? null;
}
