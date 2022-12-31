// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IVertexFactory, IVertex } from "chili-geo";
import { Token, Result, XYZ } from "chili-shared";
import { OccHelps } from "../occHelps";
import { OccVertex } from "../occShape";

@Token.set(Token.VertexFactory)
export class VertexFactory implements IVertexFactory {
    byXYZ(point: XYZ): Result<IVertex, string> {
        let build = new occ.BRepBuilderAPI_MakeVertex(OccHelps.toPnt(point));
        if (build.IsDone()) {
            return Result.ok(new OccVertex(build.Vertex()));
        }
        return Result.error("error");
    }
}
