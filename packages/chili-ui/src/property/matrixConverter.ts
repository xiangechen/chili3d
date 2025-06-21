// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter, IDisposable, Matrix4, Result } from "chili-core";

export abstract class MatrixConverter implements IConverter<Matrix4, string>, IDisposable {
    private readonly onMatrixChangeds: ((matrix: Matrix4) => void)[] = [];

    private matrix?: Matrix4;

    convert(value: Matrix4): Result<string, string> {
        this.matrix = value;
        const [x, y, z] = this.convertFrom(value);
        return Result.ok(`${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
    }

    protected abstract convertFrom(value: Matrix4): [number, number, number];
    protected abstract convertTo(matrix: Matrix4, values: [number, number, number]): Matrix4;

    convertBack(value: string): Result<Matrix4, string> {
        if (!this.matrix) return Result.err("no matrix");
        const values = value
            .split(",")
            .map(Number)
            .filter((x) => !isNaN(x));
        if (values.length !== 3) return Result.err("invalid number of values");
        const matrix = this.convertTo(this.matrix, values as [number, number, number]);
        this.onMatrixChangeds.forEach((callback) => callback(matrix));
        return Result.ok(matrix);
    }

    onMatrixChanged(callback: (matrix: Matrix4) => void): void {
        this.onMatrixChangeds.push(callback);
    }

    setMatrix(matrix: Matrix4) {
        this.matrix = matrix;
    }

    dispose() {
        this.onMatrixChangeds.length = 0;
    }
}

export namespace MatrixConverter {
    export function init() {
        let translation = new TranslationConverter();
        let scale = new ScalingConverter();
        let rotate = new RotateConverter();
        translation.onMatrixChanged((m) => {
            scale.setMatrix(m);
            rotate.setMatrix(m);
        });
        scale.onMatrixChanged((m) => {
            translation.setMatrix(m);
            rotate.setMatrix(m);
        });
        rotate.onMatrixChanged((m) => {
            translation.setMatrix(m);
            scale.setMatrix(m);
        });
        return { translation, scale, rotate };
    }
}

export class TranslationConverter extends MatrixConverter {
    protected convertFrom(matrix: Matrix4): [number, number, number] {
        let position = matrix.getPosition();
        return [position.x, position.y, position.z];
    }
    protected convertTo(matrix: Matrix4, values: [number, number, number]): Matrix4 {
        return matrix.position(values[0], values[1], values[2]);
    }
}

export class ScalingConverter extends MatrixConverter {
    protected convertFrom(matrix: Matrix4): [number, number, number] {
        let s = matrix.getScale();
        return [s.x, s.y, s.z];
    }
    protected convertTo(matrix: Matrix4, values: [number, number, number]): Matrix4 {
        return matrix.scale(values[0], values[1], values[2]);
    }
}

export class RotateConverter extends MatrixConverter {
    protected convertFrom(matrix: Matrix4): [number, number, number] {
        let s = matrix.getEulerAngles();
        return [(s.pitch * 180) / Math.PI, (s.yaw * 180) / Math.PI, (s.roll * 180) / Math.PI];
    }
    protected convertTo(matrix: Matrix4, values: [number, number, number]): Matrix4 {
        return matrix.eulerAngles(
            (values[0] * Math.PI) / 180,
            (values[1] * Math.PI) / 180,
            (values[2] * Math.PI) / 180,
        );
    }
}
