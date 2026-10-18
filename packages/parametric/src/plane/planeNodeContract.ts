// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { INode, Plane, XYZ } from "@chili3d/core";

/**
 * What another layer may ask of a datum-plane node: the plane it stands for, and the
 * explicit hook a sketch uses to make the node's DISPLAY rectangle follow its content.
 *
 * Deliberately structural rather than an import of `PlaneNode`: `planeSource.ts` and
 * `neutralPlane.ts` must resolve a plane node without importing the node class, which
 * imports them. The shape mirrors `isBodyTrackingNode` in `features/bodyTracking.ts`.
 */
export interface IPlaneNode {
    readonly id: string;
    /**
     * The plane in world coordinates, or undefined when the node has never resolved one.
     * May trigger a lazy resolution. `visited` carries the plane nodes already being
     * resolved up the chain so a reference cycle reports undefined instead of recursing.
     */
    worldPlane(visited?: ReadonlySet<string>): Plane | undefined;
    /**
     * Where the node's actual square is drawn in world space (centre and side), so a
     * picker can offer the same rectangle the user sees — not one at the frame's origin,
     * which may be far from the part.
     */
    displayQuad(): { plane: Plane; center: XYZ; width: number; height: number } | undefined;
    /** Makes the node's display rectangle follow `node`'s shape (a sketch drawn on it). */
    addDisplayDependent(node: INode): void;
    removeDisplayDependent(node: INode): void;
}

export function isPlaneNode(node: unknown): node is INode & IPlaneNode {
    if (node === undefined || node === null) return false;
    const candidate = node as Partial<IPlaneNode>;
    return (
        typeof candidate.worldPlane === "function" &&
        typeof candidate.displayQuad === "function" &&
        typeof candidate.addDisplayDependent === "function" &&
        typeof candidate.removeDisplayDependent === "function"
    );
}
