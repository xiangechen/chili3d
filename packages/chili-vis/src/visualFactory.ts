// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IVisual } from "chili-core";

export interface IVisualFactory {
    create(document: IDocument): IVisual;
}
