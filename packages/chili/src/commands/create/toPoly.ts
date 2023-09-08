// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncController, GeometryModel, IEdge, IShape, ShapeType, command } from "chili-core";
import { WireBody } from "../../bodys/wire";
import { Selection } from "../../selection";
import { IStep } from "../../step";
import { CreateFaceableCommand } from "./createCommand";

let count = 1;

@command({
    name: "convert.toPolygon",
    display: "command.toPoly",
    icon: "icon-circle",
})
export class ConverterToPoly extends CreateFaceableCommand {
    #shapes: IShape[] | undefined;

    protected override create(): GeometryModel {
        let edges = this.#shapes as IEdge[];
        let wireBody = new WireBody(this.document, edges);
        wireBody.isFace = this.isFace;
        return new GeometryModel(this.document, `Wire ${count++}`, wireBody);
    }

    protected override getSteps(): IStep[] {
        return [];
    }

    protected override async beforeExecute(): Promise<boolean> {
        if (!(await super.beforeExecute())) return false;
        let controller: AsyncController = new AsyncController();
        this.#shapes = await Selection.pickShape(
            this.document,
            ShapeType.Edge,
            "prompt.select.edges",
            controller,
        );
        return !this.restarting && this.#shapes.length > 0;
    }
}
