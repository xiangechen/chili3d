// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../base";
import { XYZ } from "../math";
import { IConverter } from "./converter";

export class XYZConverter implements IConverter<XYZ> {
    convert(value: XYZ) {
        return Result.ok(`${value.x},${value.y},${value.z}`);
    }

    convertBack(value: string): Result<XYZ> {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 3) {
            return Result.error(`${value} convert to XYZ error`);
        }
        return Result.ok(new XYZ(vs[0], vs[1], vs[2]));
    }
}
