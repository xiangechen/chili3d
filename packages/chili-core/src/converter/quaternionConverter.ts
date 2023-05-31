// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../base";
import { Quaternion } from "../math";
import { IConverter } from "./converter";

export class QuaternionConverter implements IConverter<Quaternion> {
    convert(value: Quaternion) {
        let { x, y, z } = value.toEuler();
        let s = 180 / Math.PI;
        return Result.ok(`${x * s},${y * s},${z * s}`);
    }

    convertBack(value: string): Result<Quaternion> {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 3) {
            return Result.error(`${value} convert to Quaternion error`);
        }
        let s = Math.PI / 180;
        return Result.ok(Quaternion.fromEuler(vs[0] * s, vs[1] * s, vs[2] * s));
    }
}
