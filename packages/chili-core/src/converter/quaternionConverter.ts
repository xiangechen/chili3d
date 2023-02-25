// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Quaternion } from "../math";
import { ConverterBase } from "./converter";

export class QuaternionConverter extends ConverterBase<Quaternion> {
    convert(value: Quaternion): string | undefined {
        let s = 180 / Math.PI;
        let fixed = (n: number) => Math.round(n * s * 10000) / 10000;
        return `${fixed(value.x)},${fixed(value.y)},${fixed(value.z)},${fixed(value.w)}`;
    }

    convertBack(value: string): Quaternion | undefined {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 4) {
            this._error = `${value} convert to Quaternion error`;
            return undefined;
        }
        let s = Math.PI / 180;
        return new Quaternion(vs[0] * s, vs[1] * s, vs[2] * s, vs[3] * s);
    }
}
