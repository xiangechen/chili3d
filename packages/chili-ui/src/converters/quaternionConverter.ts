// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, Quaternion, Result } from "chili-core";

export class QuaternionConverter implements IConverter<Quaternion> {
    convert(value: Quaternion) {
        const { x, y, z } = value.toEuler();
        const s = 180 / Math.PI;
        return Result.ok(`${x * s},${y * s},${z * s}`);
    }

    convertBack(value: string): Result<Quaternion> {
        const vs = value.split(",").map(Number).filter(isFinite);
        if (vs.length !== 3) {
            return Result.err(`${value} convert to Quaternion error`);
        }
        const s = Math.PI / 180;
        return Result.ok(Quaternion.fromEuler(vs[0] * s, vs[1] * s, vs[2] * s));
    }
}
