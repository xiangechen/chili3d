// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../base";
import { Quaternion } from "../math";
import { IConverter } from "./converter";

export class QuaternionConverter implements IConverter<Quaternion> {
    convert(value: Quaternion) {
        let s = 180 / Math.PI;
        let fixed = (n: number) => Math.round(n * s * 10000) / 10000;
        return Result.ok(`${fixed(value.x)},${fixed(value.y)},${fixed(value.z)},${fixed(value.w)}`);
    }

    convertBack(value: string): Result<Quaternion> {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 4) {
            return Result.error(`${value} convert to Quaternion error`);
        }
        let s = Math.PI / 180;
        return Result.ok(new Quaternion(vs[0] * s, vs[1] * s, vs[2] * s, vs[3] * s));
    }
}
