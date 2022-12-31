// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result, XYZ } from "chili-shared";
import { IEdge } from "../shape";

export interface IEdgeFactory {
    byStartAndEnd(start: XYZ, end: XYZ): Result<IEdge>;
}
