// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";
import type { XYZ } from "./xyz";

export class MathUtils {
    static degToRad(degrees: number) {
        return degrees * (Math.PI / 180);
    }

    static radToDeg(radians: number) {
        return radians * (180 / Math.PI);
    }

    static anyEqualZero(...values: number[]) {
        return values.some((value) => Math.abs(value) < Precision.Float);
    }

    static allEqualZero(...values: number[]) {
        return values.every((value) => Math.abs(value) < Precision.Float);
    }

    static almostEqual(a: number, b: number, tolerance = 1e-6) {
        return Math.abs(a - b) < tolerance;
    }

    static clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    static minMax(values: ArrayLike<number>) {
        if (values.length === 0) return undefined;

        let min = values[0];
        let max = values[0];

        for (let i = 1; i < values.length; i++) {
            const value = values[i];
            if (value < min) min = value;
            if (value > max) max = value;
        }

        return { min, max };
    }

    static computeLineSegmentDistance(seg1Start: XYZ, seg1End: XYZ, seg2Start: XYZ, seg2End: XYZ) {
        const seg1Dir = seg1End.sub(seg1Start);
        const seg2Dir = seg2End.sub(seg2Start);
        const seg1ToSeg2Vec = seg1Start.sub(seg2Start);

        const seg1DirSqLen = seg1Dir.dot(seg1Dir);
        const seg1Seg2Dot = seg1Dir.dot(seg2Dir);
        const seg2DirSqLen = seg2Dir.dot(seg2Dir);
        const seg1DirToSeg1StartDot = seg1Dir.dot(seg1ToSeg2Vec);
        const seg2DirToSeg1StartDot = seg2Dir.dot(seg1ToSeg2Vec);
        const determinant = seg1DirSqLen * seg2DirSqLen - seg1Seg2Dot * seg1Seg2Dot;

        let { sNumerator, sDenominator, tNumerator, tDenominator } = computeSTParameters(
            determinant,
            seg1Seg2Dot,
            seg2DirSqLen,
            seg1DirToSeg1StartDot,
            seg2DirToSeg1StartDot,
            seg1DirSqLen,
        );
        ({ tNumerator, sNumerator, sDenominator } = adjustSTParameters(
            tNumerator,
            tDenominator,
            sNumerator,
            sDenominator,
            seg1DirToSeg1StartDot,
            seg1DirSqLen,
            seg1Seg2Dot,
        ));

        const sParam = Math.abs(sNumerator) < Precision.Float ? 0 : sNumerator / sDenominator;
        const tParam = Math.abs(tNumerator) < Precision.Float ? 0 : tNumerator / tDenominator;

        const vecOnSeg1 = seg1Dir.multiply(sParam);
        const vecOnSeg2 = seg2Dir.multiply(tParam);

        const closestPointDiff = seg1ToSeg2Vec.add(vecOnSeg1).sub(vecOnSeg2);
        return {
            distance: closestPointDiff.length(),
            pointOnSeg1: seg1Start.add(vecOnSeg1),
            pointOnSeg2: seg2Start.add(vecOnSeg2),
        };
    }
}

function computeSTParameters(
    determinant: number,
    seg1Seg2Dot: number,
    seg2DirSqLen: number,
    seg1DirToSeg1StartDot: number,
    seg2DirToSeg1StartDot: number,
    seg1DirSqLen: number,
) {
    let sNumerator, sDenominator, tNumerator, tDenominator;
    if (determinant < Precision.Float) {
        sNumerator = 0;
        sDenominator = 1;
        tNumerator = seg2DirToSeg1StartDot;
        tDenominator = seg2DirSqLen;
    } else {
        sNumerator = seg1Seg2Dot * seg2DirToSeg1StartDot - seg2DirSqLen * seg1DirToSeg1StartDot;
        tNumerator = seg1DirSqLen * seg2DirToSeg1StartDot - seg1Seg2Dot * seg1DirToSeg1StartDot;

        if (sNumerator < 0) {
            sNumerator = 0;
            tNumerator = seg2DirToSeg1StartDot;
            tDenominator = seg2DirSqLen;
        } else if (sNumerator > determinant) {
            sNumerator = determinant;
            tNumerator = seg2DirToSeg1StartDot + seg1Seg2Dot;
            tDenominator = seg2DirSqLen;
        } else {
            sDenominator = determinant;
            tDenominator = determinant;
        }
    }
    return {
        sNumerator,
        sDenominator: sDenominator ?? determinant,
        tNumerator,
        tDenominator: tDenominator ?? determinant,
    };
}

function adjustSTParameters(
    tNumerator: number,
    tDenominator: number,
    sNumerator: number,
    sDenominator: number,
    seg1DirToSeg1StartDot: number,
    seg1DirSqLen: number,
    seg1Seg2Dot: number,
) {
    if (tNumerator < 0) {
        tNumerator = 0;
        if (-seg1DirToSeg1StartDot < 0) {
            sNumerator = 0;
        } else if (-seg1DirToSeg1StartDot > seg1DirSqLen) {
            sNumerator = sDenominator;
        } else {
            sNumerator = -seg1DirToSeg1StartDot;
            sDenominator = seg1DirSqLen;
        }
    } else if (tNumerator > tDenominator) {
        tNumerator = tDenominator;
        const adjustedValue = -seg1DirToSeg1StartDot + seg1Seg2Dot;
        if (adjustedValue < 0) {
            sNumerator = 0;
        } else if (adjustedValue > seg1DirSqLen) {
            sNumerator = sDenominator;
        } else {
            sNumerator = adjustedValue;
            sDenominator = seg1DirSqLen;
        }
    }
    return { tNumerator, sNumerator, sDenominator };
}
