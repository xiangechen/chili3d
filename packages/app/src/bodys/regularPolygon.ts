// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FacebaseNode,
    type I18nKeys,
    type IDocument,
    type IShape,
    property,
    type Result,
    serializable,
    serialize,
    type XYZ,
} from "@chili3d/core";

export interface RegularPolygonOptions {
    document: IDocument;
    normal: XYZ;
    xvec: XYZ;
    center: XYZ;
    radius: number;
    sides: number;
}

@serializable()
export class RegularPolygonNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.regularPolygon";
    }

    @serialize()
    @property("circle.center")
    get center() {
        return this.getPrivateValue("center");
    }
    set center(center: XYZ) {
        this.setPropertyEmitShapeChanged("center", center);
    }

    @serialize()
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(radius: number) {
        this.setPropertyEmitShapeChanged("radius", radius);
    }

    @serialize()
    @property("regularPolygon.sides")
    get sides() {
        return this.getPrivateValue("sides");
    }
    set sides(sides: number) {
        this.setPropertyEmitShapeChanged("sides", sides);
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    @serialize()
    get xvec(): XYZ {
        return this.getPrivateValue("xvec");
    }

    constructor(options: RegularPolygonOptions) {
        super({ document: options.document });
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("xvec", options.xvec);
        this.setPrivateValue("center", options.center);
        this.setPrivateValue("radius", options.radius);
        this.setPrivateValue("sides", options.sides);
    }

    generateShape(): Result<IShape, string> {
        const points = RegularPolygonNode.calculateVertices(
            this.center,
            this.radius,
            this.sides,
            this.normal,
            this.xvec,
        );
        const wire = this.document.application.shapeFactory.polygon(points);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }

    static calculateVertices(center: XYZ, radius: number, sides: number, normal: XYZ, xvec: XYZ): XYZ[] {
        const vertices: XYZ[] = [];

        normal = normal.normalize()!;
        xvec = xvec.normalize()!;

        const angleStep = (2 * Math.PI) / sides;
        for (let i = 0; i < sides; i++) {
            const direction = xvec.rotate(normal, i * angleStep)!;
            vertices.push(center.add(direction.multiply(radius)));
        }
        vertices.push(vertices[0]);

        return vertices;
    }
}
