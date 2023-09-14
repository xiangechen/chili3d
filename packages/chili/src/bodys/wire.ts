// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ClassMap, FaceableBody, I18nKeys, IDocument, IEdge, IShape, Result, Serializer } from "chili-core";

@ClassMap.key("WireBody")
export class WireBody extends FaceableBody {
    override name: I18nKeys = "body.wire";

    private _edges: IEdge[];
    @Serializer.property("constructor")
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

    @Serializer.deserializer()
    static from({ document, edges }: { document: IDocument; edges: IEdge[] }) {
        return new WireBody(document, edges);
    }

    protected override generateShape(): Result<IShape> {
        let wire = this.shapeFactory.wire(...this.edges);
        if (!wire.success || !this.isFace) return wire;
        let face = wire.value.toFace();
        return face.success ? face : wire;
    }
}
