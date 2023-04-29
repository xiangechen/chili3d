// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter, Result } from "chili-core";
import { gp_Pnt } from "opencascade.js";

export class PntConverter implements IConverter<gp_Pnt> {
    convert(value: gp_Pnt): Result<string> {
        return Result.ok(`${value.X()},${value.Y()},${value.Z()}`);
    }
    convertBack(value: string): Result<gp_Pnt> {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 3) {
            return Result.error(`${value} convert to XYZ error`);
        }
        return Result.ok(new occ.gp_Pnt_3(vs[0], vs[1], vs[2]));
    }
}
