// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { FaceableBody, I18nKeys, IDocument, IEdge, IShape, Result, Serializer } from "chili-core";

@Serializer.register("WireBody", ["document", "edges"])
export class WireBody extends FaceableBody {
    override name: I18nKeys = "body.wire";

    private _edges: IEdge[];
    @Serializer.property()
    get edges(): IEdge[] {
        return this._edges;
    }
    set edges(values: IEdge[]) {
        this.setPropertyAndUpdate("edges", values);
    }

    constructor(document: IDocument, edges: IEdge[]) {
        super(document);
        this._edges = [...edges];
    }

    protected override generateShape(): Result<IShape> {
        let wire = this.shapeFactory.wire(...this.edges);
        if (!wire.success || !this.isFace) return wire;
        let face = wire.value.toFace();
        return face.success ? face : wire;
    }
}
