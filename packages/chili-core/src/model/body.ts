// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { IShape } from "../geometry";
import { I18n } from "../i18n";
import { IPropertyChanged } from "../observer";
import { Result } from "../result";

export interface IBody extends IPropertyChanged {
    readonly name: keyof I18n;
    get body(): Result<IShape>;
    setDocument(document: IDocument | undefined): void;
    onUpdate(callback: () => void): void;
}
