// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IPropertyChanged, Result } from "chili-shared";
import { IShape } from "./shape";

export interface IBody extends IPropertyChanged {
    readonly name: keyof I18n;
    get body(): Result<IShape>;
    onUpdate(callback: () => void): void;
}
