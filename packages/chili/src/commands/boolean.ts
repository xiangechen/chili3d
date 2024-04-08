// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryModel, IShape, Result, command } from "chili-core";
import { BooleanBody } from "../bodys/boolean";
import { IStep, SelectModelStep } from "../step";
import { CreateCommand } from "./createCommand";

let count = 1;

export abstract class BooleanOperate extends CreateCommand {
    protected override create(): GeometryModel {
        let shape1 = (this.stepDatas[0].models?.at(0) as GeometryModel)?.geometry.shape.value!;
        let shape2 = (this.stepDatas[1].models?.at(0) as GeometryModel)?.geometry.shape.value!;
        let booleanType = this.getBooleanOperateType();
        let booleanShape: Result<IShape>;
        if (booleanType === "common") {
            booleanShape = this.application.shapeFactory.booleanCommon(shape1, shape2);
        } else if (booleanType === "cut") {
            booleanShape = this.application.shapeFactory.booleanCut(shape1, shape2);
        } else {
            booleanShape = this.application.shapeFactory.booleanFuse(shape1, shape2);
        }

        let body = new BooleanBody(this.document, booleanShape.expect("boolean operate error"));
        this.stepDatas.forEach((x) => {
            x.models?.at(0)?.parent?.remove(x.models[0]);
        });
        return new GeometryModel(this.document, `Bolean ${count++}`, body);
    }

    protected abstract getBooleanOperateType(): "common" | "cut" | "fuse";

    protected override getSteps(): IStep[] {
        return [
            new SelectModelStep("prompt.select.shape", false),
            new SelectModelStep("prompt.select.shape", false, {
                allow: (shape) => {
                    return !this.stepDatas[0].models?.map((x) => x.geometry.shape.value).includes(shape);
                },
            }),
        ];
    }
}

@command({
    name: "boolean.common",
    display: "command.boolean.common",
    icon: "icon-booleanCommon",
})
export class BooleanCommon extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "common";
    }
}

@command({
    name: "boolean.cut",
    display: "command.boolean.cut",
    icon: "icon-booleanCut",
})
export class BooleanCut extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "cut";
    }
}

@command({
    name: "boolean.fuse",
    display: "command.boolean.fuse",
    icon: "icon-booleanFuse",
})
export class BooleanFuse extends BooleanOperate {
    protected override getBooleanOperateType(): "common" | "cut" | "fuse" {
        return "fuse";
    }
}
