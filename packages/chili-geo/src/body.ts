// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-shared";
import { IShape } from "./shape";

export interface IBody {
    readonly name: keyof I18n;
    body(): IShape | undefined;
}
