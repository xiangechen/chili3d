// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "./shape";

export interface IEditedResult {
    success: boolean;
    error?: string;
}

export interface IEditor {
    shape(): IShape | undefined;
    edit(shape: IShape): IEditedResult;
    name(): string;
}
