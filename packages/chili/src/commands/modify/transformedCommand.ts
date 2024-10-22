// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    EdgeMeshData,
    GeometryNode,
    LineType,
    Matrix4,
    Property,
    PubSub,
    Transaction,
    VisualConfig,
    XYZ,
} from "chili-core";
import { MultistepCommand } from "../multistepCommand";

export abstract class TransformedCommand extends MultistepCommand {
    protected models?: GeometryNode[];
    protected positions?: number[];

    @Property.define("common.clone")
    get isClone() {
        return this.getPrivateValue("isClone", false);
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
            color: VisualConfig.defaultEdgeColor,
            groups: [],
        };
    };

    private async ensureSelectedModels() {
        this.models = this.document.selection.getSelectedNodes().filter((x) => x instanceof GeometryNode);
        if (this.models.length > 0) return true;
        this.controller = new AsyncController();
        this.models = await this.document.selection.pickModel("prompt.select.models", this.controller, true);
        if (this.models.length > 0) return true;
        if (this.controller.result?.status === "success") {
            PubSub.default.pub("showToast", "toast.select.noSelected");
        }
        return false;
    }

    protected override async canExcute(): Promise<boolean> {
        if (!(await this.ensureSelectedModels())) return false;

        this.positions = [];
        this.models!.forEach((model) => {
            let ps = model.mesh.edges?.positions;
            if (ps) this.positions = this.positions!.concat(model.matrix.ofPoints(ps));
        });
        return true;
    }

    protected getTempLineData(start: XYZ, end: XYZ) {
        return EdgeMeshData.from(start, end, VisualConfig.temporaryEdgeColor, LineType.Solid);
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
            this.document.visual.update();
        });
    }
}
