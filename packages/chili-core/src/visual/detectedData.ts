// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "../math";
import { IShape } from "../shape";
import { INodeVisual } from "./visualObject";

export interface VisualShapeData {
    shape: IShape;
    owner: INodeVisual;
    point?: XYZ;
    directShape?: IShape;
    indexes: number[];
}
