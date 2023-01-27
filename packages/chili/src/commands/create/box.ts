// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, IView, Model } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Container, Token, XYZ } from "chili-core";
import { BoxBody } from "../../bodys";
import { Dimension } from "../../snap";
import { AnyPointStep, PointStep, RectStep } from "../step";

@command({
    name: "Box",
    display: "command.box",
    icon: "icon-box",
})
export class Box implements ICommand {
    async excute(document: IDocument): Promise<boolean> {
        let point = await new AnyPointStep().perform(document, "operate.pickFistPoint");
        if (point === undefined) return false;
        let rect = await new RectStep(point).perform(document, "operate.pickNextPoint");
        if (rect === undefined) return false;
        let handleTempLine = (view: IView, point: XYZ) => {
            let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
            return factory!.box(rect!.plane, rect!.dx, rect!.dy, point.distanceTo(rect!.p2)).value;
        };
        let p3 = await new PointStep(rect.p2, Dimension.D1D2D3, handleTempLine).perform(
            document,
            "operate.pickNextPoint"
        );
        if (p3 === undefined) return false;
        let body = new BoxBody(rect.plane, rect.dx, rect.dy, p3.distanceTo(rect.p2));
        document.addModel(new Model(`Box ${document.modelCount + 1}`, Id.new(), body));
        document.viewer.redraw();
        return true;
    }
}
