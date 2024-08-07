// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryType, IGeometry } from "chili-core";
import { Geom_Geometry } from "../occ-wasm/chili_occ";

export abstract class OccGeometry implements IGeometry {
    private _geometryType: GeometryType;
    get geometryType(): GeometryType {
        return this._geometryType;
    }
    constructor(readonly geometry: Geom_Geometry) {
        this._geometryType = this.getGeometryType(geometry);
    }

    private getGeometryType(geometry: Geom_Geometry) {
        let isKind = (type: string) => geometry.IsKind_2(type);

        if (isKind("Geom_Curve")) {
            return GeometryType.Curve;
        } else if (isKind("Geom_Surface")) {
            return GeometryType.Surface;
        }

        throw new Error("Unknown geometry type");
    }

    dispose() {
        this.geometry.delete();
    }

    abstract copy(): IGeometry;
}
