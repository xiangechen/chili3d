import {
    EdgeMeshData,
    FaceMeshData,
    IShapeMeshData,
    LineType,
    ShapeMeshGroup,
    VisualConfig,
} from "chili-core";
import { EdgeMesher, FaceMesher } from "../lib/chili-wasm";
import { OcctHelper } from "./helper";
import { OccShape } from "./shape";

export class Mesher implements IShapeMeshData {
    private isEdgeMeshed: boolean = false;
    private isFaceMeshed: boolean = false;

    private _lines?: EdgeMeshData;
    private _faces?: FaceMeshData;

    get edges(): EdgeMeshData | undefined {
        if (!this.isEdgeMeshed) {
            this.isEdgeMeshed = true;
            let edgeMesher = new wasm.EdgeMesher(this.shape.shape, 0.1);
            this._lines = {
                lineType: LineType.Solid,
                positions: edgeMesher.getPosition(),
                groups: this.getEdgeGroups(edgeMesher),
                color: VisualConfig.defaultEdgeColor,
            } as any;
            edgeMesher.delete();
        }
        return this._lines;
    }
    get faces(): FaceMeshData | undefined {
        if (!this.isFaceMeshed) {
            this.isFaceMeshed = true;
            let faceMesher = new wasm.FaceMesher(this.shape.shape, 0.1);
            this._faces = {
                positions: faceMesher.getPosition(),
                normals: faceMesher.getNormal(),
                uvs: faceMesher.getUV(),
                indices: faceMesher.getIndex(),
                groups: this.getFaceGroups(faceMesher),
                color: VisualConfig.defaultFaceColor,
            } as any;
            faceMesher.delete();
        }
        return this._faces;
    }

    constructor(readonly shape: OccShape) {}

    updateMeshShape(): void {
        this.isEdgeMeshed = false;
        this.isFaceMeshed = false;
    }

    private getEdgeGroups(mesher: EdgeMesher): ShapeMeshGroup[] {
        let result: ShapeMeshGroup[] = [];
        let groups = mesher.getGroups();
        for (let i = 0; i < mesher.getEdgeSize(); i++) {
            result.push({
                start: groups[2 * i],
                count: groups[2 * i + 1],
                shape: OcctHelper.wrapShape(mesher.getEdge(i)),
            });
        }
        return result;
    }

    private getFaceGroups(mesher: FaceMesher): ShapeMeshGroup[] {
        let result: ShapeMeshGroup[] = [];
        let groups = mesher.getGroups();
        for (let i = 0; i < mesher.getFaceSize(); i++) {
            result.push({
                start: groups[2 * i],
                count: groups[2 * i + 1],
                shape: OcctHelper.wrapShape(mesher.getFace(i)),
            });
        }
        return result;
    }
}
