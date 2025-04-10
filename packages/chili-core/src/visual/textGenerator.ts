// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IVisualObject } from "./visualObject";

export interface ITextGenerator {
    generate(text: string, size: number, color: number, font: "fzhei"): Promise<IVisualObject>;
}
