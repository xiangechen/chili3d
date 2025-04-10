// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { XYZ } from "../math";
import { IShape } from "../shape";
import { IVisualGeometry } from "./visualObject";

export interface VisualShapeData {
    shape: IShape;
    owner: IVisualGeometry;
    point?: XYZ;
    directShape?: IShape;
    indexes: number[];
}
