// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { HistoryObservable } from "../foundation";
import { I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { Serializer } from "../serialize";

export abstract class Entity extends HistoryObservable {
    abstract display: I18nKeys;

    protected _matrix: Matrix4 = Matrix4.identity();
    @Serializer.serialze()
    get matrix(): Matrix4 {
        return this._matrix;
    }
    set matrix(value: Matrix4) {
        this.setProperty(
            "matrix",
            value,
            (_p, oldMatrix) => {
                this.onMatrixChanged(value, oldMatrix);
            },
            {
                equals: (left, right) => left.equals(right),
            },
        );
    }

    protected onMatrixChanged(newMatrix: Matrix4, oldMatrix: Matrix4): void {}
}
