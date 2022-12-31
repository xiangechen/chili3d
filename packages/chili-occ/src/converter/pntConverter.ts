// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter, ConverterBase } from "chili-shared";
import { gp_Pnt, gp_Pnt_3 } from "opencascade.js";

export class PntConverter extends ConverterBase<gp_Pnt> {
    convert(value: gp_Pnt): string | undefined {
        return `${value.X()},${value.Y()},${value.Z()}`;
    }
    convertBack(value: string): gp_Pnt | undefined {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 3) {
            this._error = `${value} convert to XYZ error`;
            return undefined;
        }
        return new occ.gp_Pnt_3(vs[0], vs[1], vs[2]);
    }
}
