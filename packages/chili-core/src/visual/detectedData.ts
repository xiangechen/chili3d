// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IShape } from "../shape";
import { IVisualGeometry } from "./visualShape";

export interface VisualShapeData {
    shape: IShape;
    owner: IVisualGeometry;
    indexes: number[];
}
