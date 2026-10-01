// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, type ShapeNode } from "@chili3d/core";
import type { FeatureContext } from "./feature";

/**
 * Maps a shape into the host body's local space — the space its feature chain lives in,
 * since the node carries its own transform and the renderer applies it on top. Every
 * feature that combines with the chain input (a boolean operation, a joint section) has
 * to bring its geometry there first.
 *
 * `node` is the shape's owner when it came out of a node (a sketch's or a body's own
 * shape); undefined when the shape already arrives in world coordinates — a tool the
 * feature just built from world-space picks, or a face `resolveSourceFaces` returned.
 * Identity transforms reuse the shape; copies are pushed to `owned` for the caller to
 * dispose.
 */
export function mapToHost(
    shape: IShape,
    node: ShapeNode | undefined,
    context: FeatureContext,
    owned: IShape[],
): IShape {
    const hostInverse = context.host.worldTransform().invert();
    let transform = hostInverse;
    if (node !== undefined) {
        const world = node.worldTransform();
        transform = hostInverse === undefined ? world : hostInverse.multiply(world);
    }
    if (transform === undefined || transform.equals(Matrix4.identity())) return shape;
    const mapped = shape.transformedMul(transform);
    owned.push(mapped);
    return mapped;
}

/** A built tool: its geometry plus the sub-shape ids the kernel history named for it. */
export interface HostMappedTool {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * The tool's geometry in the host's local space, ready to be booleaned against the chain
 * input. The id arrays pass through untouched: the mapping is a rigid copy, and
 * `transformedMul` preserves the sub-shape enumeration they run parallel to.
 */
export function mapToolToHost(
    tool: HostMappedTool,
    context: FeatureContext,
    owned: IShape[],
): HostMappedTool {
    const shape = mapToHost(tool.shape, undefined, context, owned);
    return shape === tool.shape ? tool : { shape, faceIds: tool.faceIds, edgeIds: tool.edgeIds };
}
