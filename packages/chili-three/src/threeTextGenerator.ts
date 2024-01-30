// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, ITextGenerator } from "chili-core";
import { DoubleSide, MeshBasicMaterial, ShapeGeometry } from "three";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { ThreeHelper } from "./threeHelper";
import { ThreeMeshObject } from "./threeMeshObject";

export class ThreeTextGenerator implements ITextGenerator {
    private readonly _fonts: Map<string, Font> = new Map();

    async generate(text: string, size: number, color: Color, fontName = "fzhei") {
        let font = await this._getFont(fontName);
        let shapes = font.generateShapes(text, size);
        const geometry = new ShapeGeometry(shapes);
        let material = new MeshBasicMaterial({
            color: ThreeHelper.fromColor(color),
            side: DoubleSide,
        });
        return new ThreeMeshObject(geometry, material);
    }

    private async _getFont(fontName: string) {
        let font = this._fonts.get(fontName);
        if (!font) {
            const loader = new FontLoader();
            font = await loader.loadAsync(`fonts/${fontName}.json`);
            this._fonts.set(fontName, font);
        }
        return font;
    }
}
