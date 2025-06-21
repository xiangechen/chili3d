// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FacebaseNode,
    I18nKeys,
    IDocument,
    IShape,
    Plane,
    Property,
    Result,
    Serializer,
    XYZ,
} from "chili-core";

@Serializer.register(["document", "plane", "dx", "dy"])
export class RectNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.rect";
    }

    @Serializer.serialze()
    @Property.define("rect.dx")
    get dx() {
        return this.getPrivateValue("dx");
    }
    set dx(dx: number) {
        this.setPropertyEmitShapeChanged("dx", dx);
    }

    @Serializer.serialze()
    @Property.define("rect.dy")
    get dy() {
        return this.getPrivateValue("dy");
    }
    set dy(dy: number) {
        this.setPropertyEmitShapeChanged("dy", dy);
    }

    @Serializer.serialze()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }

    constructor(document: IDocument, plane: Plane, dx: number, dy: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("dx", dx);
        this.setPrivateValue("dy", dy);
    }

    generateShape(): Result<IShape, string> {
        let points = RectNode.points(this.plane, this.dx, this.dy);
        let wire = this.document.application.shapeFactory.polygon(points);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }

    static points(plane: Plane, dx: number, dy: number): XYZ[] {
        let start = plane.origin;
        return [
            start,
            start.add(plane.xvec.multiply(dx)),
            start.add(plane.xvec.multiply(dx)).add(plane.yvec.multiply(dy)),
            start.add(plane.yvec.multiply(dy)),
            start,
        ];
    }
}
