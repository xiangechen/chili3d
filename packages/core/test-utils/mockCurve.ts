// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ICurve, IShape, ITrimmedCurve, ShapeType, XYZLike } from "../src";
import { Matrix4, ShapeTypes } from "../src";
import { XYZ } from "../src/math";
import type { VisualShapeData } from "../src/visual";

/**
 * Creates a lightweight duck-typed curve object for snap unit tests.
 * Provides enough of the ICurve surface for nearestExtrema-based snapping
 * and parametric point evaluation.
 *
 * @param options.nearestPoint — if set, nearestExtrema() returns this point (wrapped as { p1 })
 * @param options.length — curve length; defaults to 1. Controls value(t), endPoint(), and length()
 * @param options.overrides — extra duck-typed properties merged last (e.g. axis/center/radius for type-guard tests)
 */
export function createMockCurve(options?: {
    nearestPoint?: XYZ;
    length?: number;
    overrides?: Record<string, unknown>;
}) {
    const len = options?.length ?? 1;
    return {
        nearestExtrema: () => (options?.nearestPoint ? { p1: options.nearestPoint } : undefined),
        basisCurve: {},
        startPoint: () => XYZ.zero,
        endPoint: () => new XYZ({ x: len, y: 0, z: 0 }),
        firstParameter: () => 0,
        lastParameter: () => 1,
        value: (t: number) => new XYZ({ x: t * len, y: 0, z: 0 }),
        project: () => [],
        length: () => len,
        intersect: () => [],
        ...options?.overrides,
    } as unknown as ICurve;
}

export interface MockEdgeCurveConfig {
    start?: XYZ;
    end?: XYZ;
    mid?: XYZ;
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    basisCurve?: Record<string, unknown>;
    projectResult?: XYZ[];
    nearestPoint?: { p1: XYZ };
    isCircle?: boolean;
    circleCenter?: XYZ;
    tangentPoints?: XYZ[];
    /** Custom value(t) evaluator; defaults to a unit-speed segment from origin along +X. */
    valueFn?: (t: number) => XYZ;
    /** Result of nearestFromPoint(); defaults to { point: XYZ.zero, parameter: 0, distance: 0 }. */
    nearestFromPointResult?: { point: XYZ; parameter: number; distance: number };
}

/**
 * A realistic `ITrimmedCurve.nearestFromPoint` for a straight segment mock: the
 * perpendicular projection clamped to [start, end]. `parameter` is normalized to
 * [0, 1] like the line-mock convention (`pointAt(t)` interpolates start → end).
 */
export function nearestOnSegment(start: XYZ, end: XYZ, point: XYZLike) {
    const p = new XYZ({ x: point.x, y: point.y, z: point.z });
    const direction = end.sub(start);
    const lengthSq = direction.lengthSq();
    const t = lengthSq < 1e-12 ? 0 : Math.min(1, Math.max(0, p.sub(start).dot(direction) / lengthSq));
    const nearest = start.add(direction.multiply(t));
    return { point: nearest, parameter: t, distance: p.distanceTo(nearest) };
}

/**
 * A realistic `ITrimmedCurve.nearestFromPoint` for a full-circle mock in the XY
 * plane: the radial projection onto the circumference.
 */
export function nearestOnCircle(center: XYZ, radius: number, point: XYZLike) {
    const p = new XYZ({ x: point.x, y: point.y, z: point.z });
    const offset = p.sub(center);
    const length = offset.length();
    const direction = length < 1e-12 ? XYZ.unitX : offset.multiply(1 / length);
    const nearest = center.add(direction.multiply(radius));
    return { point: nearest, parameter: 0, distance: Math.abs(length - radius) };
}

export function createMockEdgeCurve(config?: MockEdgeCurveConfig) {
    const start = config?.start ?? XYZ.zero;
    const end = config?.end ?? new XYZ({ x: 10, y: 0, z: 0 });
    return {
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        length: () => 10,
        value: config?.valueFn ?? ((t: number) => new XYZ({ x: t * 10, y: 0, z: 0 })),
        project: () => config?.projectResult ?? [],
        nearestExtrema: () => config?.nearestPoint,
        basisCurve: {
            center: config?.circleCenter ?? XYZ.zero,
            radius: 5,
            axis: XYZ.unitZ,
            ...config?.basisCurve,
        },
        isClosed: () => false,
        period: () => 0,
        isPeriodic: () => false,
        continuity: () => 0,
        isCN: () => false,
        trim: () => ({}) as ITrimmedCurve,
        d0: (u: number) => new XYZ({ x: u * 10, y: 0, z: 0 }),
        d1: () => ({ point: XYZ.zero, vec: XYZ.unitX }),
        d2: () => ({ point: XYZ.zero, vec1: XYZ.unitX, vec2: XYZ.unitY }),
        d3: () => ({ point: XYZ.zero, vec1: XYZ.unitX, vec2: XYZ.unitY, vec3: XYZ.unitZ }),
        dn: () => XYZ.unitX,
        reverse: () => {},
        reversed: () => ({}) as ICurve,
        nearestFromPoint: () =>
            config?.nearestFromPointResult ?? { point: XYZ.zero, parameter: 0, distance: 0 },
        uniformAbscissaByLength: () => [],
        uniformAbscissaByCount: () => [],
        parameter: () => 0,
        curveType: 0,
        setTrim: () => {},
    } as unknown as ITrimmedCurve;
}

export interface MockVisualShapeConfig {
    shapeType?: ShapeType;
    shapeId?: string;
    transform?: Matrix4;
    point?: XYZ;
    curve?: ITrimmedCurve;
}

export function createMockVisualShapeData(config?: MockVisualShapeConfig): VisualShapeData {
    const shapeType = config?.shapeType ?? ShapeTypes.edge;
    const point = config?.point ?? XYZ.zero;
    const curve = config?.curve ?? createMockEdgeCurve();
    const shape = {
        id: config?.shapeId ?? `mock-shape-${Math.random()}`,
        shapeType,
        point: () => point,
        curve,
        transformedMul: (t: Matrix4) => {
            return {
                shapeType,
                intersect: () => [],
                dispose: () => {},
                curve,
            };
        },
        intersect: () => [],
        dispose: () => {},
    } as unknown as IShape & {
        point(): XYZ;
        curve: ITrimmedCurve;
        intersect(other: IShape | unknown): unknown[];
    };
    return {
        shape,
        owner: { node: { document: {} } } as never,
        transform: config?.transform ?? Matrix4.identity(),
        indexes: [],
        point,
    } as unknown as VisualShapeData;
}
