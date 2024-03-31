// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Body, I18nKeys, IDocument, IEdge, IShape, Result, Serializer } from "chili-core";

@Serializer.register("WireBody", ["document", "edges"])
export class WireBody extends Body {
    override display: I18nKeys = "body.wire";

    private _edges: IEdge[];
    @Serializer.serialze()
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
        return this.shapeFactory.wire(...this.edges);
    }
}
