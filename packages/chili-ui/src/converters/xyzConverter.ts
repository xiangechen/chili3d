// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, Result, XY, XYZ } from "chili-core";

export class XYConverter implements IConverter<XY> {
    convert(value: XY) {
        return Result.ok(`${value.x},${value.y}`);
    }

    convertBack(value: string): Result<XY> {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 2) {
            return Result.err(`${value} convert to XY error`);
        }
        return Result.ok(new XY(vs[0], vs[1]));
    }
}

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
            return Result.err(`${value} convert to XYZ error`);
        }
        return Result.ok(new XYZ(vs[0], vs[1], vs[2]));
    }
}
