// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    IApplication,
    ICommand,
    IDocument,
    Material,
    Plane,
    XYZ,
    command,
} from "chili-core";

export abstract class PerformanceTestCommand implements ICommand {
    protected size = 10;
    protected gap = 1;
    protected rowCols = 20;

    async execute(app: IApplication): Promise<void> {
        let document = await app.newDocument("OCC Performace Test");

        const start = performance.now();
        const distance = this.gap + this.size;
        for (let x = 0; x < this.rowCols; x++) {
            for (let y = 0; y < this.rowCols; y++) {
                for (let z = 0; z < this.rowCols; z++) {
                    let position = XYZ.zero
                        .add(XYZ.unitX.multiply(x * distance))
                        .add(XYZ.unitY.multiply(y * distance))
                        .add(XYZ.unitZ.multiply(z * distance));
                    this.createShape(document, document.materials.at(0)!, position);
                }
            }
        }
        document.visual.update();
        alert(
            `Create ${this.rowCols * this.rowCols * this.rowCols} shapes, Time: ${performance.now() - start} ms`,
        );
    }

    protected abstract createShape(document: IDocument, material: Material, position: XYZ): void;
}

@command({
    key: "test.performace",
    icon: "",
})
export class OccPerformanceTestCommand extends PerformanceTestCommand {
    private index = 1;
    shapes: any[] = [];

    protected override createShape(document: IDocument, material: Material, position: XYZ): void {
        let plane = Plane.XY.translateTo(position);
        let box = document.application.shapeFactory.box(
            plane,
            this.size * Math.random(),
            this.size * Math.random(),
            this.size * Math.random(),
        ).value;
        let node = new EditableShapeNode(document, `box ${this.index++}`, box, material.id);
        document.addNode(node);
    }
}
