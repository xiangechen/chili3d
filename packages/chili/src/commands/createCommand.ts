// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EditableGeometryEntity,
    GeometryEntity,
    GeometryModel,
    GeometryNode,
    I18n,
    ParameterGeometryEntity,
    Property,
    ShapeType,
    Transaction,
} from "chili-core";
import { MultistepCommand } from "./multistepCommand";

let count = 1;

export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let geometry = this.geometryEntity();
            let name = this.getModelName(geometry) + count++;
            let model = new GeometryModel(this.document, name, geometry);
            this.document.addNode(model);
            this.document.visual.update();
        });
    }

    private getModelName(geometry: GeometryEntity): string {
        if (geometry instanceof EditableGeometryEntity) {
            return ShapeType[geometry.shape.ok().shapeType];
        } else if (geometry instanceof ParameterGeometryEntity) {
            return I18n.translate(geometry.body.display);
        }
        return "model";
    }

    protected abstract geometryEntity(): GeometryEntity;
}

export abstract class CreateNodeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.document.addNode(this.getNode());
            this.document.visual.update();
        });
    }

    protected abstract getNode(): GeometryNode;
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
