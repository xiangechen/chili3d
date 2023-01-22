// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { I18n, XYZ } from "chili-shared";
import { Snapper } from "../../snap";
import { IStep } from "./step";

export class LengthStep implements IStep<number> {
    async perform(document: IDocument, tip: keyof I18n): Promise<number | undefined> {
        let snap = new Snapper(document);
        // return await snap.snapPointAsync(tip, { dimension: Dimension.D1D2D3 });
        return 1;
    }
}
