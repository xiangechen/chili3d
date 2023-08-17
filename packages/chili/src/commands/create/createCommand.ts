// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, Transaction } from "chili-core";
import { MultistepCommand } from "../multistepCommand";

export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let model = this.create();
            this.document.addNode(model);
            this.document.visual.viewer.redraw();
        });
    }

    protected abstract create(): GeometryModel;
}
