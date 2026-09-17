// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { VisualShapeData } from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";

/**
 * Moves the profile faces of sketches ahead of the rest of what the pointer detected. A
 * sketch drawn on a solid face is coplanar with it, so a raycast hits both at the same
 * depth and the order they come back in flips with the smallest pointer movement — which
 * makes a pick that takes the first entry flicker between the two. The sketch is what the
 * user put on that face, so it is the one the pick should take.
 */
export function prioritizeSketchFaces(detected: VisualShapeData[]): VisualShapeData[] {
    const sketches = detected.filter((x) => x.owner.node instanceof SketchNode);
    if (sketches.length === 0 || sketches.length === detected.length) return detected;
    return [...sketches, ...detected.filter((x) => !(x.owner.node instanceof SketchNode))];
}
