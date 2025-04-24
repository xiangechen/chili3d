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
import { OcctHelper } from "./helper";
import { OccShape } from "./shape";

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
    get faces(): FaceMeshData | undefined {
        if (this._faces === undefined) {
            this.mesh();
        }
        return this._faces;
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

            this._faces = Mesher.parseFaceMeshData(faceMeshData);
            this._lines = Mesher.parseEdgeMeshData(edgeMeshData);
        });
    }

    private static parseFaceMeshData(faceMeshData: OccFaceMeshData): FaceMeshData {
        return {
            position: new Float32Array(faceMeshData.position),
            normal: new Float32Array(faceMeshData.normal),
            uv: new Float32Array(faceMeshData.uv),
            index: faceMeshData.index,
            range: Mesher.getFaceRanges(faceMeshData),
            color: VisualConfig.defaultFaceColor,
        };
    }

    private static parseEdgeMeshData(edgeMeshData: OccEdgeMeshData): EdgeMeshData {
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

    updateMeshShape(): void {
        if (this._lines !== undefined) {
            wasm.Shape.findSubShapes(this.shape.shape, wasm.TopAbs_ShapeEnum.TopAbs_EDGE).forEach(
                (edge, i) => {
                    let s = this._lines!.range[i].shape;
                    this._lines!.range[i].shape = OcctHelper.wrapShape(edge, s.id);
                    s.dispose();
                },
            );
        }
        if (this._faces !== undefined) {
            wasm.Shape.findSubShapes(this.shape.shape, wasm.TopAbs_ShapeEnum.TopAbs_FACE).forEach(
                (face, i) => {
                    let s = this._faces!.range[i].shape;
                    this._faces!.range[i].shape = OcctHelper.wrapShape(face, s.id);
                    s.dispose();
                },
            );
        }
    }

    private static getEdgeRanges(data: OccEdgeMeshData): ShapeMeshRange[] {
        let result: ShapeMeshRange[] = [];
        for (let i = 0; i < data.edges.length; i++) {
            result.push({
                start: data.group[2 * i],
                count: data.group[2 * i + 1],
                shape: OcctHelper.wrapShape(data.edges[i]),
            });
        }
        return result;
    }

    private static getFaceRanges(data: OccFaceMeshData): ShapeMeshRange[] {
        let result: ShapeMeshRange[] = [];
        for (let i = 0; i < data.faces.length; i++) {
            result.push({
                start: data.group[2 * i],
                count: data.group[2 * i + 1],
                shape: OcctHelper.wrapShape(data.faces[i]),
            });
        }
        return result;
    }
}
