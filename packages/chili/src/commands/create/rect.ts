// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, Model, RectBody } from "chili-core";
import { AnyPointStep } from "../step/pointStep";
import { RectStep } from "../step/rectStep";

@command({
    name: "Rect",
    display: "command.rect",
    icon: "icon-rect",
})
export class Rect implements ICommand {
    constructor() {}

    async excute(document: IDocument): Promise<boolean> {
        let point = await new AnyPointStep().perform(document, "operate.pickFistPoint");
        if (point === undefined) return false;
        let rect = await new RectStep(point).perform(document, "operate.pickNextPoint");
        if (rect === undefined) return false;
        let body = new RectBody(rect.plane, rect.dx, rect.dy);
        document.addModel(new Model(`Rect ${document.modelCount + 1}`, Id.new(), body));
        document.viewer.redraw();
        return true;
    }
}
