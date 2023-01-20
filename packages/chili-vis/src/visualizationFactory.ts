// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IVisualization } from "chili-vis";
import { IDocument } from "chili-core";

export interface IVisualizationFactory {
    create(document: IDocument): IVisualization;
}
