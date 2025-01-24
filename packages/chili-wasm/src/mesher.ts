import {
    EdgeMeshData,
    FaceMeshData,
    IDisposable,
    IShapeMeshData,
    LineType,
    ShapeMeshGroup,
    VisualConfig,
} from "chili-core";
import { EdgeMesher, FaceMesher } from "../lib/chili-wasm";
import { OcctHelper } from "./helper";
import { OccShape } from "./shape";

export class Mesher implements IShapeMeshData, IDisposable {
    private readonly _lineDeflection: number;
    private _lines?: EdgeMeshData;
    private _faces?: FaceMeshData;

    get edges(): EdgeMeshData | undefined {
        if (this._lines === undefined) {
            let edgeMesher = new wasm.EdgeMesher(this.shape.shape, this._lineDeflection);
            this._lines = {
                lineType: LineType.Solid,
                positions: edgeMesher.getPosition(),
                groups: this.getEdgeGroups(edgeMesher),
                color: VisualConfig.defaultEdgeColor,
            };
            edgeMesher.delete();
        }
        return this._lines;
    }
    get faces(): FaceMeshData | undefined {
        if (this._faces === undefined) {
            let faceMesher = new wasm.FaceMesher(this.shape.shape, this._lineDeflection);
            this._faces = {
                positions: faceMesher.getPosition(),
                normals: faceMesher.getNormal(),
                uvs: faceMesher.getUV(),
                indices: faceMesher.getIndex(),
                groups: this.getFaceGroups(faceMesher),
                color: VisualConfig.defaultFaceColor,
            };
            faceMesher.delete();
        }
        return this._faces;
    }

    constructor(private shape: OccShape) {
        this._lineDeflection = wasm.boundingBoxRatio(this.shape.shape, 0.001);
    }

    dispose(): void {
        this._faces?.groups.forEach((g) => g.shape.dispose());
        this._lines?.groups.forEach((g) => g.shape.dispose());

        this.shape = null as any;
        this._faces = null as any;
        this._lines = null as any;
    }

    updateMeshShape(): void {
        if (this._lines !== undefined) {
            wasm.Shape.findSubShapes(this.shape.shape, wasm.TopAbs_ShapeEnum.TopAbs_EDGE).forEach(
                (edge, i) => {
                    let s = this._lines!.groups[i].shape;
                    this._lines!.groups[i].shape = OcctHelper.wrapShape(edge, s.id);
                    s.dispose();
                },
            );
        }
        if (this._faces !== undefined) {
            wasm.Shape.findSubShapes(this.shape.shape, wasm.TopAbs_ShapeEnum.TopAbs_FACE).forEach(
                (face, i) => {
                    let s = this._faces!.groups[i].shape;
                    this._faces!.groups[i].shape = OcctHelper.wrapShape(face, s.id);
                    s.dispose();
                },
            );
        }
    }

    private getEdgeGroups(mesher: EdgeMesher): ShapeMeshGroup[] {
        let result: ShapeMeshGroup[] = [];
        let groups = mesher.getGroups();
        let edges = mesher.getEdges();
        for (let i = 0; i < edges.length; i++) {
            result.push({
                start: groups[2 * i],
                count: groups[2 * i + 1],
                shape: OcctHelper.wrapShape(edges[i]),
            });
        }
        return result;
    }

    private getFaceGroups(mesher: FaceMesher): ShapeMeshGroup[] {
        let result: ShapeMeshGroup[] = [];
        let groups = mesher.getGroups();
        let faces = mesher.getFaces();
        for (let i = 0; i < faces.length; i++) {
            result.push({
                start: groups[2 * i],
                count: groups[2 * i + 1],
                shape: OcctHelper.wrapShape(faces[i]),
            });
        }
        return result;
    }
}
