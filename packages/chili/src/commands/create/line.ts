// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, Model } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Container, Token, XYZ } from "chili-shared";
import { LineBody } from "../../bodys";
import { Dimension } from "../../snap";
import { AnyPointStep, PointStep } from "../step";

@command({
    name: "Line",
    display: "command.line",
    icon: "icon-line",
})
export class Line implements ICommand {
    constructor() {}

    async excute(document: IDocument): Promise<boolean> {
        let start = await new AnyPointStep().perform(document, "operate.pickFistPoint");
        while (true) {
            if (start === undefined) break;
            let end = await new PointStep(start, Dimension.D1D2D3, (v, p) => this.handleTempLine(start!, p)).perform(
                document,
                "operate.pickNextPoint"
            );
            if (end === undefined) break;
            document.addModel(new Model(`Line ${document.modelCount + 1}`, Id.new(), new LineBody(start, end!)));
            document.viewer.redraw();
            start = end;
        }
        return true;
    }

    private handleTempLine = (start: XYZ, end: XYZ) => {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.line(start, end).value;
    };
}
