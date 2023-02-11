// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { IHistoryHandler } from "../history";
import { I18n } from "../i18n";
import { IPropertyChanged } from "../observer";
import { Result } from "../result";
import { IUpdateHandler } from "./updateHandler";

export interface IBody extends IPropertyChanged, IHistoryHandler, IUpdateHandler {
    readonly name: keyof I18n;
    get shape(): Result<IShape>;
    generate(): boolean;
}
