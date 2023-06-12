// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter, IDisposable, Matrix4, Result } from "chili-core";

export abstract class MatrixConverter implements IConverter<Matrix4, string>, IDisposable {
    private readonly onMatrixChangeds: ((matrix: Matrix4) => void)[] = [];

    private matrix?: Matrix4;

    convert(value: Matrix4): Result<string, string> {
        this.matrix = value;
        const from = this.convertFrom(value);
        return Result.ok(`${from[0].toFixed(2)}, ${from[1].toFixed(2)}, ${from[2].toFixed(2)}`);
    }

    protected abstract convertFrom(value: Matrix4): [number, number, number];
    protected abstract convertTo(matrix: Matrix4, values: [number, number, number]): Matrix4;

    convertBack(value: string): Result<Matrix4, string> {
        if (!this.matrix) return Result.error("no matrix");
        const values = value
            .split(",")
            .map((x) => Number(x))
            .filter((x) => x !== undefined);
        if (values.length !== 3) return Result.error("invalid number of values");
        let matrix = this.convertTo(this.matrix!, [values[0], values[1], values[2]]);
        this.onMatrixChangeds.forEach((x) => x(matrix));
        return Result.ok(matrix);
    }

    onMatrixChanged(callback: (matrix: Matrix4) => void): void {
        this.onMatrixChangeds.push(callback);
    }

    setMatrix(matrix: Matrix4) {
        this.matrix = matrix;
    }

    dispose(): void | Promise<void> {
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
        let s = matrix.getScaling();
        return [s.x, s.y, s.z];
    }
    protected convertTo(matrix: Matrix4, values: [number, number, number]): Matrix4 {
        return matrix.scaling(values[0], values[1], values[2]);
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
            (values[2] * Math.PI) / 180
        );
    }
}
