// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryEntity, GeometryModel, IShape, ParameterGeometryEntity, Result, command } from "chili-core";
import { BooleanBody } from "../bodys/boolean";
import { IStep, SelectModelStep } from "../step";
import { CreateCommand } from "./createCommand";

export abstract class BooleanOperate extends CreateCommand {
    protected override geometryEntity(): GeometryEntity {
        let shape1 = (this.stepDatas[0].models?.at(0) as GeometryModel)?.geometry.shape.ok();
        let shape2 = (this.stepDatas[1].models?.at(0) as GeometryModel)?.geometry.shape.ok();
        let booleanType = this.getBooleanOperateType();
        let booleanShape: Result<IShape>;
        if (booleanType === "common") {
            booleanShape = this.application.shapeFactory.booleanCommon(shape1, shape2);
        } else if (booleanType === "cut") {
            booleanShape = this.application.shapeFactory.booleanCut(shape1, shape2);
        } else {
            booleanShape = this.application.shapeFactory.booleanFuse(shape1, shape2);
        }

        let body = new BooleanBody(this.document, booleanShape.ok());
        this.stepDatas.forEach((x) => {
            x.models?.at(0)?.parent?.remove(x.models[0]);
        });
        return new ParameterGeometryEntity(this.document, body);
    }

    protected abstract getBooleanOperateType(): "common" | "cut" | "fuse";

    protected override getSteps(): IStep[] {
        return [
            new SelectModelStep("prompt.select.shape", false),
            new SelectModelStep("prompt.select.shape", false, {
                allow: (shape) => {
                    return !this.stepDatas[0].models?.map((x) => x.geometry.shape.ok()).includes(shape);
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
