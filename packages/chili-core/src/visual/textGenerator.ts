// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color } from "../base";
import { IVisualObject } from "./visualObject";

export interface ITextGenerator {
    generate(text: string, size: number, color: Color, font: "fzhei"): Promise<IVisualObject>;
}
