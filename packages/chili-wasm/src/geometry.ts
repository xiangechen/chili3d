// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryType, type IGeometry, type Matrix4 } from "chili-core";
import type { Geom_Geometry, Handle_Geom_Geometry } from "../lib/chili-wasm";
import { convertFromMatrix } from "./helper";

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
        const isKind = (type: string) => wasm.Transient.isKind(geometry, type);

        if (isKind("Geom_Curve")) {
            return GeometryType.Curve;
        } else if (isKind("Geom_Surface")) {
            return GeometryType.Surface;
        }

        throw new Error("Unknown geometry type");
    }

    #disposed = false;
    dispose = () => {
        if (!this.#disposed) {
            this.#disposed = true;
            this.disposeInternal();
        }
    };

    protected disposeInternal() {
        this._handleGeometry.delete();
    }

    transform(value: Matrix4) {
        this.geometry.transform(convertFromMatrix(value));
    }

    abstract copy(): IGeometry;
    abstract transformed(matrix: Matrix4): IGeometry;
}
