// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, LineBody, Model, Dimension, Snapper } from "chili-core";
import { IEdgeFactory } from "chili-geo";
import { Commands, i18n, inject, injectable, Token, XYZ } from "chili-shared";

@injectable()
@command({
    name: Commands.Line,
    display: "command.line",
    icon: "icon-line",
})
export class Line implements ICommand {
    constructor(@inject(Token.EdgeFactory) private factory: IEdgeFactory) {}

    async excute(document: IDocument): Promise<boolean> {
        let snap = new Snapper(document);
        let start = await snap.snapPointAsync(Dimension.D1D2D3, "请输入起点");
        if (start === undefined) return false;
        let end = await snap.snapPointAsync(Dimension.D1D2D3, "请输入终点", start, (p) =>
            this.handleTempLine(start!, p)
        );
        if (end === undefined) return false;
        document.addModel(new Model(document, `Line ${document.modelCount + 1}`, Id.new(), new LineBody(start, end)));
        document.viewer.redraw();
        return true;
    }

    private handleTempLine = (start: XYZ, end: XYZ) => {
        if (start.isEqualTo(end)) return undefined;
        return this.factory.byStartAndEnd(start, end).ok();
    };
}
