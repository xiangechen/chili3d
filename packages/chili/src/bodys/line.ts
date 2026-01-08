// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    property,
    type Result,
    serializable,
    serialze,
    type XYZ,
} from "chili-core";

@serializable(["document", "start", "end"])
export class LineNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.line";
    }

    @serialze()
    @property("line.start")
    get start() {
        return this.getPrivateValue("start");
    }
    set start(pnt: XYZ) {
        this.setPropertyEmitShapeChanged("start", pnt);
    }

    @serialze()
    @property("line.end")
    get end() {
        return this.getPrivateValue("end");
    }
    set end(pnt: XYZ) {
        this.setPropertyEmitShapeChanged("end", pnt);
    }

    constructor(document: IDocument, start: XYZ, end: XYZ) {
        super(document);
        this.setPrivateValue("start", start);
        this.setPrivateValue("end", end);
    }

    generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.line(this.start, this.end);
    }
}
