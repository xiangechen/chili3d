// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody, IShape } from "chili-geo";
import { I18n, ObservableBase, Result } from "chili-shared";

export abstract class BodyBase extends ObservableBase implements IBody {
    abstract name: keyof I18n;

    abstract body(): Result<IShape>;
}
