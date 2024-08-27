import {
    EditableGeometryEntity,
    GeometryModel,
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
        let lightGray = new Material(document, "LightGray", 0xdedede);
        let deepGray = new Material(document, "DeepGray", 0x898989);
        document.materials.push(lightGray, deepGray);

        const start = Date.now();
        const distance = this.gap + this.size;
        for (let x = 0; x < this.rowCols; x++) {
            for (let y = 0; y < this.rowCols; y++) {
                for (let z = 0; z < this.rowCols; z++) {
                    let position = XYZ.zero
                        .add(XYZ.unitX.multiply(x * distance))
                        .add(XYZ.unitY.multiply(y * distance))
                        .add(XYZ.unitZ.multiply(z * distance));
                    this.createShape(document, lightGray, position);
                }
            }
        }
        console.log(
            `Create ${this.rowCols * this.rowCols * this.rowCols} shapes, Time: ${Date.now() - start} ms`,
        );
    }

    protected abstract createShape(document: IDocument, material: Material, position: XYZ): void;
}

@command({
    name: "test.performace",
    display: "test.performace",
    icon: "",
})
export class OccPerformanceTestCommand extends PerformanceTestCommand {
    private index = 1;

    protected override createShape(document: IDocument, material: Material, position: XYZ): void {
        let plane = Plane.XY.translateTo(position);
        let box = document.application.shapeFactory.box(
            plane,
            this.size * Math.random(),
            this.size * Math.random(),
            this.size * Math.random(),
        );
        let entity = new EditableGeometryEntity(document, box.ok(), material.id);
        let model = new GeometryModel(document, `box ${this.index++}`, entity);
        document.addNode(model);
    }
}

// export class ThreePerformanceTestCommand extends PerformanceTestCommand {

// }
