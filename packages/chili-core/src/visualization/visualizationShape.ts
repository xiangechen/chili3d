// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModel, IShape } from "chili-core";

export interface IVisualizationShape {
    get shape(): IShape;
    get visible(): boolean;
    set visible(value: boolean);
    hilightedState(): void;
    unHilightedState(): void;
    selectedState(): void;
    unSelectedState(): void;
}
