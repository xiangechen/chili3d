// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, LineBody, Model, Dimension, Snapper } from "chili-core";
import { IEdgeFactory } from "chili-geo";
import { inject, injectable, Token, XYZ } from "chili-shared";

@injectable()
@command({
    name: "Line",
    display: "command.line",
    icon: "icon-line",
})
export class Line implements ICommand {
    constructor(@inject(Token.EdgeFactory) private factory: IEdgeFactory) {}

    async excute(document: IDocument): Promise<boolean> {
        let snap = new Snapper(document);
        let start = await snap.snapPointAsync(Dimension.D1D2D3, "command.line.pickStart");
        if (start === undefined) return false;
        let end = await snap.snapPointAsync(Dimension.D1D2D3, "command.line.pickEnd", start, (p) =>
            this.handleTempLine(start!, p)
        );
        if (end === undefined) return false;
        document.addModel(new Model(`Line ${document.modelCount + 1}`, Id.new(), new LineBody(start, end)));
        document.viewer.redraw();
        return true;
    }

    private handleTempLine = (start: XYZ, end: XYZ) => {
        if (start.isEqualTo(end)) return undefined;
        return this.factory.byStartAndEnd(start, end).ok();
    };
}
