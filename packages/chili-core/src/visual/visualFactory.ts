// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IVisual } from "./visual";

export interface IVisualFactory {
    create(document: IDocument): IVisual;
}
