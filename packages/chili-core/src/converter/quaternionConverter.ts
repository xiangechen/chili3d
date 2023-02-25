// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Quaternion } from "../math";
import { ConverterBase } from "./converter";

export class QuaternionConverter extends ConverterBase<Quaternion> {
    convert(value: Quaternion): string | undefined {
        return `${value.x},${value.y},${value.z},${value.w}`;
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
        return new Quaternion(vs[0], vs[1], vs[2], vs[3]);
    }
}
