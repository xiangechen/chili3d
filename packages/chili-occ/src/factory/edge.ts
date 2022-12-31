// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEdgeFactory, IEdge } from "chili-geo";
import { Token, Result, XYZ } from "chili-shared";
import { OccHelps } from "../occHelps";
import { OccEdge } from "../occShape";

@Token.set(Token.EdgeFactory)
export class EdgeFactory implements IEdgeFactory {
    byStartAndEnd(start: XYZ, end: XYZ): Result<IEdge> {
        let make = new occ.BRepBuilderAPI_MakeEdge_3(OccHelps.toPnt(start), OccHelps.toPnt(end));
        if (make.IsDone()) {
            return Result.ok(new OccEdge(make.Edge()));
        }
        return Result.error("error");
    }
}
