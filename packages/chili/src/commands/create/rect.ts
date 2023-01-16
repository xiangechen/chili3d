// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, LineBody, Model, Dimension, Snapper, RectBody } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { inject, injectable, Plane, Token, XYZ } from "chili-shared";
import { IView } from "chili-vis";

interface RectData {
    plane: Plane;
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
        let start = await snap.snapPointAsync("operate.pickFistPoint", { dimension: Dimension.D1D2D3 });
        if (start === undefined) return false;
        let lastView: IView | undefined = undefined;
        let end = await snap.snapPointAsync("operate.pickNextPoint", {
            dimension: Dimension.D1D2,
            refPoint: start,
            creator: (view, p) => {
                lastView = view;
                return this.handleTempRect(view, start!, p);
            },
        });
        if (end === undefined || lastView === undefined) return false;
        let { plane, dx, dy } = this.getRectData(lastView, start, end);
        document.addModel(new Model(`Rect ${document.modelCount + 1}`, Id.new(), new RectBody(plane, dx, dy)));
        document.viewer.redraw();
        return true;
    }

    private handleTempRect = (view: IView, start: XYZ, end: XYZ) => {
        if (start.isEqualTo(end)) return undefined;
        let { plane, dx, dy } = this.getRectData(view, start, end);
        return this.factory.rect(plane, dx, dy).ok();
    };

    private getRectData(view: IView, start: XYZ, end: XYZ): RectData {
        let plane = new Plane(start, view.workplane.normal, view.workplane.x);
        let vector = end.sub(start);
        let dx = vector.dot(plane.x);
        let dy = vector.dot(plane.y);
        return { plane, dx, dy };
    }
}
