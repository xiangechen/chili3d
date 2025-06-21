// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter, Result, XY, XYZ } from "chili-core";

export class XYConverter implements IConverter<XY> {
    convert(value: XY) {
        return Result.ok(`${value.x},${value.y}`);
    }

    convertBack(value: string): Result<XY> {
        const vs = value.split(",").map(Number).filter(isFinite);
        return vs.length === 2
            ? Result.ok(new XY(vs[0], vs[1]))
            : Result.err(`${value} convert to XY error`);
    }
}

export class XYZConverter implements IConverter<XYZ> {
    convert(value: XYZ) {
        return Result.ok(`${value.x},${value.y},${value.z}`);
    }

    convertBack(value: string): Result<XYZ> {
        const vs = value.split(",").map(Number).filter(isFinite);
        return vs.length === 3
            ? Result.ok(new XYZ(vs[0], vs[1], vs[2]))
            : Result.err(`${value} convert to XYZ error`);
    }
}
