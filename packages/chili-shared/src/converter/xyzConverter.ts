// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XYZ } from "../math";
import { ConverterBase } from "./converter";

export class XYZConverter extends ConverterBase<XYZ> {
    convert(value: XYZ): string | undefined {
        return `${value.x},${value.y},${value.z}`;
    }

    convertBack(value: string): XYZ | undefined {
        let vs = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => !isNaN(x));
        if (vs.length !== 3) {
            this._error = `${value} convert to XYZ error`;
            return undefined;
        }
        return new XYZ(vs[0], vs[1], vs[2]);
    }
}
