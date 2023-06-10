// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, IDocument, Transaction } from "chili-core";
import { MultistepCommand } from "../multistepCommand";

export abstract class CreateCommand extends MultistepCommand {
    protected override excuting(document: IDocument) {
        Transaction.excute(document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let model = this.create(document);
            document.addNode(model);
            document.visual.viewer.redraw();
        });
    }

    protected abstract create(document: IDocument): GeometryModel;
}
