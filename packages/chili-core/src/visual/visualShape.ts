// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, IModel, IShape } from "chili-core";

export interface IVisualShape {
    get shape(): IShape;
    visible: boolean;
    color: Color;
    transparency: number;
    hilightedState(): void;
    unHilightedState(): void;
    selectedState(): void;
    unSelectedState(): void;
}
