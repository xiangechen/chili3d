// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../base";
import { XYZ } from "../math";
import { IConverter } from "./converter";

export class XYZConverter implements IConverter<XYZ> {
    convert(value: XYZ) {
        return Result.success(`${value.x},${value.y},${value.z}`);
    }

    convertBack(value: string): Result<XYZ> {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 3) {
            return Result.error(`${value} convert to XYZ error`);
        }
        return Result.success(new XYZ(vs[0], vs[1], vs[2]));
    }
}
