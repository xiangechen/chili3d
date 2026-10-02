// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, Result, type ShapeMeshData } from "@chili3d/core";
import type { BooleanOperation } from "../features/feature";
import type { ParametricBodyNode } from "../parametricBodyNode";

/**
 * The shape in world coordinates: identity transforms reuse it, transformed copies are
 * pushed to `owned` for the caller to dispose. A body's shape lives in its own local space
 * while everything a picking command builds is world-space, so this is where the two meet.
 */
export function worldShape<T extends IShape>(shape: T, transform: Matrix4, owned: IShape[]): T {
    if (transform.equals(Matrix4.identity())) return shape;
    const world = shape.transformedMul(transform) as T;
    owned.push(world);
    return world;
}

/**
 * `operation` of the world-space `tool` against one target body, also in world coordinates.
 * The committed body runs the same boolean in its own space instead (the feature layer);
 * a rigid transform commutes with it, so the two agree. `tool` is not consumed — the caller
 * owns it — and the result is the caller's to dispose.
 */
export function booleanInWorld(
    operation: BooleanOperation,
    tool: IShape,
    target: ParametricBodyNode,
): Result<IShape> {
    if (!target.shape.isOk) return Result.err(target.shape.error);

    const owned: IShape[] = [];
    try {
        const base = worldShape(target.shape.value, target.worldTransform(), owned);
        switch (operation) {
            case "cut":
                return shapeFactory.booleanCut([base], [tool]);
            case "common":
                return shapeFactory.booleanCommon([base], [tool]);
            default:
                return shapeFactory.booleanFuse([base], [tool], true);
        }
    } finally {
        // The world copy is this call's to free — the kernel has read it by now.
        for (const copy of owned) {
            copy.dispose();
        }
    }
}

/** What the viewport shows for a boolean scope: the meshes, and the bodies they stand in for. */
export interface TargetPreview {
    readonly meshes: ShapeMeshData[];
    readonly hidden: ParametricBodyNode[];
}

/**
 * The preview of a join/cut/intersect against every target: one result per target, meshed,
 * plus the bodies those results stand in for — a body the preview replaces must go away, or
 * the preview would be drawn over the geometry it rewrote.
 *
 * A target whose boolean fails contributes neither a mesh nor a hidden body: its result is
 * not shown, so hiding it would blank a body the user can still see the original of. The
 * commit still appends the feature to it, and that body reports the failure from its own
 * chain — the same way a failing boolean surfaces today.
 */
export function buildTargetPreview(
    operation: BooleanOperation,
    tool: IShape,
    targets: readonly ParametricBodyNode[],
): TargetPreview {
    const meshes: ShapeMeshData[] = [];
    const hidden: ParametricBodyNode[] = [];
    for (const target of targets) {
        const result = booleanInWorld(operation, tool, target);
        if (!result.isOk) continue;

        try {
            const { faces, edges } = result.value.mesh;
            if (faces !== undefined) meshes.push(faces);
            if (edges !== undefined) meshes.push(edges);
            hidden.push(target);
        } finally {
            result.value.dispose();
        }
    }
    return { meshes, hidden };
}
