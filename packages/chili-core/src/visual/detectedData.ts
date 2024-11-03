// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
