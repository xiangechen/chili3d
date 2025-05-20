// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EdgeMeshData,
    FaceMeshData,
    gc,
    IDisposable,
    IShapeMeshData,
    LineType,
    ShapeMeshRange,
    VisualConfig,
} from "chili-core";
import { EdgeMeshData as OccEdgeMeshData, FaceMeshData as OccFaceMeshData } from "../lib/chili-wasm";
import { OccShape, OccSubEdgeShape, OccSubFaceShape } from "./shape";

export class Mesher implements IShapeMeshData, IDisposable {
    private _isMeshed = false;
    private _lines?: EdgeMeshData;
    private _faces?: FaceMeshData;

    get edges(): EdgeMeshData | undefined {
        if (this._lines === undefined) {
            this.mesh();
        }
        return this._lines;
    }
    set edges(value: EdgeMeshData | undefined) {
        this._lines = value;
    }

    get faces(): FaceMeshData | undefined {
        if (this._faces === undefined) {
            this.mesh();
        }
        return this._faces;
    }
    set faces(value: FaceMeshData | undefined) {
        this._faces = value;
    }

    constructor(private shape: OccShape) {}

    private mesh() {
        if (this._isMeshed) {
            return;
        }
        this._isMeshed = true;

        gc((c) => {
            const occMesher = c(new wasm.Mesher(this.shape.shape, 0.005));
            const meshData = c(occMesher.mesh());
            const faceMeshData = c(meshData.faceMeshData);
            const edgeMeshData = c(meshData.edgeMeshData);

            this._faces = this.parseFaceMeshData(faceMeshData);
            this._lines = this.parseEdgeMeshData(edgeMeshData);
        });
    }

    private parseFaceMeshData(faceMeshData: OccFaceMeshData): FaceMeshData {
        return {
            position: new Float32Array(faceMeshData.position),
            normal: new Float32Array(faceMeshData.normal),
            uv: new Float32Array(faceMeshData.uv),
            index: new Uint32Array(faceMeshData.index),
            range: this.getFaceRanges(faceMeshData),
            color: VisualConfig.defaultFaceColor,
            groups: [],
        };
    }

    private parseEdgeMeshData(edgeMeshData: OccEdgeMeshData): EdgeMeshData {
        return {
            lineType: LineType.Solid,
            position: new Float32Array(edgeMeshData.position),
            range: this.getEdgeRanges(edgeMeshData),
            color: VisualConfig.defaultEdgeColor,
        };
    }

    dispose(): void {
        this._faces?.range.forEach((g) => g.shape.dispose());
        this._lines?.range.forEach((g) => g.shape.dispose());

        this.shape = null as any;
        this._faces = null as any;
        this._lines = null as any;
    }

    private getEdgeRanges(data: OccEdgeMeshData): ShapeMeshRange[] {
        let result: ShapeMeshRange[] = [];
        for (let i = 0; i < data.edges.length; i++) {
            result.push({
                start: data.group[2 * i],
                count: data.group[2 * i + 1],
                shape: new OccSubEdgeShape(this.shape, data.edges[i], i),
            });
        }
        return result;
    }

    private getFaceRanges(data: OccFaceMeshData): ShapeMeshRange[] {
        let result: ShapeMeshRange[] = [];
        for (let i = 0; i < data.faces.length; i++) {
            result.push({
                start: data.group[2 * i],
                count: data.group[2 * i + 1],
                shape: new OccSubFaceShape(this.shape, data.faces[i], i),
            });
        }
        return result;
    }
}
