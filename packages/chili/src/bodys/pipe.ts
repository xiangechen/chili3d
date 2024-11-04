import {
    I18nKeys,
    IDocument,
    IShape,
    ParameterShapeNode,
    Property,
    Result,
    Serializer,
    XYZ,
} from "chili-core";

@Serializer.register(["document", "outsideDiameter", "wallThickness", "bendingRadius", "points"])
export class PipeNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.pipe";
    }

    @Serializer.serialze()
    @Property.define("pipe.points")
    get points() {
        return this.getPrivateValue("points");
    }
    set points(value: XYZ[]) {
        this.setProperty("points", value);
    }

    @Property.define("pipe.outsideDiameter")
    get outsideDiameter() {
        return this.getPrivateValue("outsideDiameter");
    }
    set outsideDiameter(value: number) {
        this.setProperty("outsideDiameter", value);
    }

    @Property.define("pipe.wallThickness")
    get wallThickness() {
        return this.getPrivateValue("wallThickness");
    }
    set wallThickness(value: number) {
        this.setProperty("wallThickness", value);
    }

    @Property.define("pipe.bendingRadius")
    get bendingRadius() {
        return this.getPrivateValue("bendingRadius");
    }
    set bendingRadius(value: number) {
        this.setProperty("bendingRadius", value);
    }

    constructor(
        document: IDocument,
        outside_diameter: number,
        wall_thickness: number,
        bending_radius: number,
        points: XYZ[],
    ) {
        super(document);
        this.setPrivateValue("points", points);
        this.setPrivateValue("outsideDiameter", outside_diameter);
        this.setPrivateValue("wallThickness", wall_thickness);
        this.setPrivateValue("bendingRadius", bending_radius);
    }

    generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.pipe(
            this.outsideDiameter,
            this.wallThickness,
            this.bendingRadius,
            ...this.points,
        );
    }
}
