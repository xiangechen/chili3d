// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IVisualObject } from "./visualObject";

export interface ITextGenerator {
    generate(text: string, size: number, color: number, font: "fzhei"): Promise<IVisualObject>;
}
