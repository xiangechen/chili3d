// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryModel, Property, Transaction } from "chili-core";
import { MultistepCommand } from "./multistepCommand";

export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let model = this.create();
            this.document.addNode(model);
            this.document.visual.highlighter.clear();
            this.document.visual.update();
        });
    }

    protected abstract create(): GeometryModel;
}

export abstract class CreateFaceableCommand extends CreateCommand {
    protected _isFace: boolean = false;
    @Property.define("command.faceable.isFace")
    public get isFace() {
        return this._isFace;
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
