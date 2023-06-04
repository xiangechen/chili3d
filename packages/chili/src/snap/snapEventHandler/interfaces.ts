// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape, Result, XYZ } from "chili-core";

export interface Validator {
    (point: XYZ): boolean;
}

export interface ShapePreviewer {
    (point: XYZ): IShape | undefined;
}

export interface ITextParser<T> {
    parse(text: string): Result<T>;
}

export class XYZParser implements ITextParser<XYZ> {
    parse(text: string): Result<XYZ, string> {
        throw new Error("Method not implemented.");
    }
}
