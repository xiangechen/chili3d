// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Matrix4, XYZ } from "../math";
import type { IShape } from "../shape";
import type { INodeVisual } from "./visualObject";

export interface VisualShapeData {
    shape: IShape;
    owner: INodeVisual;
    transform: Matrix4;
    point?: XYZ;
    indexes: number[];
}

/**
 * Whether two picks name the same sub-shape of the same visual. Identity is the owner plus
 * the shape id and the indexes — not the shape object: cloned nodes share the same id
 * (serialization preserves it), so an object comparison would miss the copy.
 */
export function isSameShapeData(a: VisualShapeData, b: VisualShapeData): boolean {
    return (
        a.owner === b.owner &&
        a.shape.id === b.shape.id &&
        a.indexes.length === b.indexes.length &&
        a.indexes.every((v, i) => v === b.indexes[i])
    );
}
