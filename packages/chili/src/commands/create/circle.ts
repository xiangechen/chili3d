// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, LineBody, Model, Dimension, Snapper, CircleBody } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { inject, injectable, Token, XYZ } from "chili-shared";
import { IView } from "chili-vis";
import { AnyPointStep, PointStep } from "../step";

@injectable()
@command({
    name: "Circle",
    display: "command.circle",
    icon: "icon-circle",
})
export class Circle implements ICommand {
    constructor(@inject(Token.ShapeFactory) private factory: IShapeFactory) {}

    async excute(document: IDocument): Promise<boolean> {
        let start = await new AnyPointStep().perform(document, "operate.pickFistPoint");
        if (start === undefined) return false;
        let normal: XYZ | undefined = undefined;
        let end = await new PointStep(start, Dimension.D1D2D3, (v, p) => {
            normal = v.workplane.normal;
            return this.handleTemp(v, start!, p);
        }).perform(document, "operate.pickRadius");
        if (end === undefined) return false;
        let body = new CircleBody(normal!, start, end.distanceTo(start));
        document.addModel(new Model(`Circle ${document.modelCount + 1}`, Id.new(), body));
        document.viewer.redraw();
        return true;
    }

    private handleTemp = (view: IView, start: XYZ, end: XYZ) => {
        if (start.isEqualTo(end)) return undefined;
        return this.factory.circle(view.workplane.normal, start, end.distanceTo(start)).value;
    };
}
