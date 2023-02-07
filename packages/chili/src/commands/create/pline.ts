// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, Id, IDocument, inject, injectable, Model, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { LineBody } from "../../bodys";
import { Dimension, Snapper } from "../../snap";

// @injectable()
// @command({
//     name: "PLine",
//     display: "command.line",
//     icon: "icon-pline",
// })
// export class PLine implements ICommand {
//     constructor(@inject(Token.ShapeFactory) private factory: IShapeFactory) {}

//     async excute(document: IDocument): Promise<boolean> {
//         let snap = new Snapper(document);
//         let start = await snap.snapPointAsync("operate.pickFistPoint", { dimension: Dimension.D1D2D3 });
//         if (start === undefined) return false;
//         let end = await snap.snapPointAsync("operate.pickNextPoint", {
//             dimension: Dimension.D1D2D3,
//             refPoint: start.point,
//             preview: (view, p) => this.handleTempLine(start!.point, p),
//         });
//         if (end === undefined) return false;
//         document.addModel(new Model(`Line ${document.modelCount + 1}`, Id.new(), new LineBody(start.point, end.point)));
//         document.viewer.redraw();
//         return true;
//     }

//     private handleTempLine = (start: XYZ, end: XYZ) => {
//         if (start.isEqualTo(end)) return undefined;
//         return this.factory.line(start, end).value;
//     };
// }
