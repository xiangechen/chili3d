// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryType, IGeometry } from "chili-core";
import { Geom_Geometry, Handle_Geom_Geometry } from "../lib/chili-wasm";

export abstract class OccGeometry implements IGeometry {
    private readonly _geometryType: GeometryType;
    private readonly _handleGeometry: Handle_Geom_Geometry;

    get geometryType(): GeometryType {
        return this._geometryType;
    }

    constructor(readonly geometry: Geom_Geometry) {
        this._handleGeometry = new wasm.Handle_Geom_Geometry(geometry);
        this._geometryType = this.getGeometryType(geometry);
    }

    private getGeometryType(geometry: Geom_Geometry) {
        let isKind = (type: string) => wasm.Transient.isKind(geometry, type);

        if (isKind("Geom_Curve")) {
            return GeometryType.Curve;
        } else if (isKind("Geom_Surface")) {
            return GeometryType.Surface;
        }

        throw new Error("Unknown geometry type");
    }

    dispose() {
        this._handleGeometry.delete();
    }

    abstract copy(): IGeometry;
}
