// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IPropertyChanged, Result } from "chili-shared";
import { IDocument } from "./document";
import { IShape } from "./geometry";

export interface IBody extends IPropertyChanged {
    readonly name: keyof I18n;
    get body(): Result<IShape>;
    setDocument(document: IDocument | undefined): void;
    onUpdate(callback: () => void): void;
}
