// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    Config,
    EdgeMeshData,
    I18n,
    IModel,
    INode,
    LineType,
    Matrix4,
    Property,
    Transaction,
    XYZ,
} from "chili-core";
import { Selection } from "../../selection";
import { MultistepCommand } from "../multistepCommand";

export abstract class TransformedCommand extends MultistepCommand {
    protected models?: IModel[];
    protected positions?: number[];

    private _isClone: boolean = false;
    @Property.define("common.clone")
    get isClone() {
        return this._isClone;
    }

    set isClone(value: boolean) {
        this.setProperty("isClone", value);
    }

    protected abstract transfrom(p2: XYZ): Matrix4;

    protected transformPreview = (point: XYZ) => {
        let transform = this.transfrom(point);
        let positions = transform.ofPoints(this.positions!);
        return {
            positions,
            lineType: LineType.Solid,
            color: Config.instance.visual.faceEdgeColor,
            groups: [],
        };
    };

    protected getTempLineData(start: XYZ, end: XYZ) {
        return EdgeMeshData.from(start, end, Config.instance.visual.temporaryEdgeColor, LineType.Solid);
    }

    protected override async beforeExecute(): Promise<boolean> {
        await super.beforeExecute();
        this.models = this.document.selection
            .getSelectedNodes()
            .filter((x) => INode.isModelNode(x)) as IModel[];
        if (this.models.length === 0) {
            this.controller = new AsyncController();
            this.models = await Selection.pickModel(this.document, "prompt.select.models", this.controller);
            if (this.restarting || this.models.length === 0) {
                alert(I18n.translate("prompt.select.noModelSelected"));
                return false;
            }
        }
        this.positions = [];
        this.models.forEach((model) => {
            let ps = model.shape()?.mesh.edges?.positions;
            if (ps) this.positions = this.positions!.concat(model.matrix.ofPoints(ps));
        });
        return true;
    }

    protected executeMainTask(): void {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let models = this.models;
            if (this.isClone) {
                models = models?.map((x) => x.clone());
            }
            let transform = this.transfrom(this.stepDatas.at(-1)!.point!);
            models?.forEach((x) => {
                x.matrix = x.matrix.multiply(transform);
            });
            this.document.visual.viewer.update();
        });
    }
}
