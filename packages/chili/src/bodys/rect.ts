// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FacebaseNode,
    type I18nKeys,
    type IDocument,
    type IShape,
    type Plane,
    property,
    type Result,
    serializable,
    serialze,
    type XYZ,
} from "chili-core";

@serializable(["document", "plane", "dx", "dy"])
export class RectNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.rect";
    }

    @serialze()
    @property("rect.dx")
    get dx() {
        return this.getPrivateValue("dx");
    }
    set dx(dx: number) {
        this.setPropertyEmitShapeChanged("dx", dx);
    }

    @serialze()
    @property("rect.dy")
    get dy() {
        return this.getPrivateValue("dy");
    }
    set dy(dy: number) {
        this.setPropertyEmitShapeChanged("dy", dy);
    }

    @serialze()
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
        const points = RectNode.points(this.plane, this.dx, this.dy);
        const wire = this.document.application.shapeFactory.polygon(points);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }

    static points(plane: Plane, dx: number, dy: number): XYZ[] {
        const start = plane.origin;
        return [
            start,
            start.add(plane.xvec.multiply(dx)),
            start.add(plane.xvec.multiply(dx)).add(plane.yvec.multiply(dy)),
            start.add(plane.yvec.multiply(dy)),
            start,
        ];
    }
}
