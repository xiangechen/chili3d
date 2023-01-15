// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, LineBody, Model, Dimension, Snapper, RectBody } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { inject, injectable, Plane, Token, XYZ } from "chili-shared";
import { IView } from "chili-vis";

interface RectData {
    dx: number;
    dy: number;
}

@injectable()
@command({
    name: "Rect",
    display: "command.rect",
    icon: "icon-rect",
})
export class Rect implements ICommand {
    constructor(@inject(Token.ShapeFactory) private factory: IShapeFactory) {}

    async excute(document: IDocument): Promise<boolean> {
        let snap = new Snapper(document);
        let start = await snap.snapPointAsync(Dimension.D1D2D3, "operate.pickFistPoint");
        if (start === undefined) return false;
        let plane: Plane | undefined = undefined;
        let end = await snap.snapPointAsync(Dimension.D1D2D3, "operate.pickNextPoint", start, (view, p) => {
            plane = view.workplane;
            return this.handleTempRect(view, start!, p);
        });
        if (end === undefined || plane === undefined) return false;
        let { dx, dy } = this.getRectData(plane, start, end);
        document.addModel(new Model(`Rect ${document.modelCount + 1}`, Id.new(), new RectBody(plane, dx, dy)));
        document.viewer.redraw();
        return true;
    }

    private handleTempRect = (view: IView, start: XYZ, end: XYZ) => {
        if (start.isEqualTo(end)) return undefined;
        let plane = view.workplane;
        let { dx, dy } = this.getRectData(plane, start, end);
        return this.factory.rect(plane, dx, dy).ok();
    };

    private getRectData(plane: Plane, start: XYZ, end: XYZ): RectData {
        let vector = end.sub(start);
        let dx = vector.dot(plane.xDirection);
        let dy = vector.dot(plane.yDirection);
        return { dx, dy };
    }
}
