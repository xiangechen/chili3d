// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Config,
    EdgeMeshData,
    IDocument,
    IModel,
    INode,
    LineType,
    Matrix4,
    Transaction,
    XYZ,
    i18n,
} from "chili-core";
import { Selection } from "../../selection";
import { MultistepCommand } from "../multistepCommand";

export abstract class TransformedCommand extends MultistepCommand {
    protected models?: IModel[];
    protected positions?: number[];

    protected abstract transfrom(p2: XYZ): Matrix4;
    protected abstract isClone(): boolean;

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

    protected override async beforeExcute(document: IDocument): Promise<boolean> {
        this.models = document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x)) as IModel[];
        if (this.models.length === 0) {
            this.models = await Selection.pickModel(document, "prompt.select.models");
            if (this.models.length === 0) {
                alert(i18n["prompt.select.noModelSelected"]);
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

    protected excuting(document: IDocument): void {
        Transaction.excute(document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let transform = this.transfrom(this.stepDatas.at(-1)!.point);
            let models = this.models;
            if (this.isClone()) {
                models = models?.map((x) => x.clone());
            }
            models?.forEach((x) => {
                x.matrix = x.matrix.multiply(transform);
            });
            document.visual.viewer.redraw();
        });
    }
}
