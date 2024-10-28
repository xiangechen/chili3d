// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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

@Serializer.register(["document", "start", "end"])
export class LineNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.line";
    }

    @Serializer.serialze()
    @Property.define("line.start")
    get start() {
        return this.getPrivateValue("start");
    }
    set start(pnt: XYZ) {
        this.setPropertyEmitShapeChanged("start", pnt);
    }

    @Serializer.serialze()
    @Property.define("line.end")
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
