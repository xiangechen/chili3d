// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ARROW_HOVER_TOLERANCE,
    distanceToSegment,
    type IView,
    MeshDataUtils,
    Plane,
    type XYZ,
} from "@chili3d/core";

export type SectionRotationAxis = "x" | "y";

export interface SectionRotationHandle {
    readonly axis: SectionRotationAxis;
    readonly origin: XYZ;
    readonly rotationAxis: XYZ;
    readonly radial: XYZ;
    readonly tangent: XYZ;
    readonly radius: number;
    readonly points: XYZ[];
}

const ARC_SEGMENTS = 24;
const ARC_SWEEP = (20 * Math.PI) / 180;
export const SECTION_ARC_RADIUS_RATIO = 1.1;

export function sectionRotationHandle(
    axis: SectionRotationAxis,
    center: XYZ,
    direction: XYZ,
    xvec: XYZ,
    yvec: XYZ,
    arrowLength: number,
): SectionRotationHandle {
    const rotationAxis = axis === "x" ? xvec : yvec;
    const fallback = axis === "x" ? yvec : xvec;
    const projected = direction.sub(rotationAxis.multiply(direction.dot(rotationAxis))).normalize();
    const radial = projected ?? fallback;
    const tangent = rotationAxis.cross(radial).normalize() ?? fallback;
    const radius = arrowLength * SECTION_ARC_RADIUS_RATIO;
    const points: XYZ[] = [];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const angle = -ARC_SWEEP + (2 * ARC_SWEEP * i) / ARC_SEGMENTS;
        const vector = radial.rotate(rotationAxis, angle) ?? radial;
        points.push(center.add(vector.multiply(radius)));
    }
    return { axis, origin: center, rotationAxis, radial, tangent, radius, points };
}

export function rotationHandleMidpoint(handle: SectionRotationHandle): XYZ {
    return handle.points[Math.floor(handle.points.length / 2)];
}

export function rotationHandleDistance(
    view: IView,
    event: PointerEvent,
    handle: SectionRotationHandle,
): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < handle.points.length; i++) {
        const a = view.worldToScreen(handle.points[i]);
        const b = view.worldToScreen(handle.points[i + 1]);
        best = Math.min(best, distanceToSegment(event.offsetX, event.offsetY, a, b));
    }
    return best;
}

export function projectRotationValue(
    view: IView,
    event: PointerEvent,
    handle: SectionRotationHandle,
): number | undefined {
    const ray = view.rayAt(event.offsetX, event.offsetY);
    const fromOrigin = handle.origin.sub(ray.point);
    const coplanar =
        Math.abs(ray.direction.dot(handle.rotationAxis)) < 1e-8 &&
        Math.abs(fromOrigin.dot(handle.rotationAxis)) < 1e-6;
    if (coplanar) return undefined;
    const radial =
        handle.radial.sub(handle.rotationAxis.multiply(handle.radial.dot(handle.rotationAxis))).normalize() ??
        handle.tangent;
    const plane = new Plane({ origin: handle.origin, normal: handle.rotationAxis, xvec: radial });
    const point = plane.intersectRay(ray);
    if (!point) return undefined;
    const offset = point.sub(handle.origin);
    const planar = offset.sub(handle.rotationAxis.multiply(offset.dot(handle.rotationAxis)));
    return (Math.atan2(planar.dot(handle.tangent), planar.dot(radial)) * 180) / Math.PI;
}

export function rotationHandleMesh(handle: SectionRotationHandle, color: number, lineWidth = 2.5) {
    return MeshDataUtils.createPolylineMesh(handle.points, color, lineWidth);
}

export function isRotationHandleHit(distance: number): boolean {
    return distance <= ARROW_HOVER_TOLERANCE;
}
