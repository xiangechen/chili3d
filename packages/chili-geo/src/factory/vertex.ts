// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result, XYZ } from "chili-shared";
import { IEdge, IVertex } from "../shape";

export interface IVertexFactory {
    byXYZ(point: XYZ): Result<IVertex>;
}
