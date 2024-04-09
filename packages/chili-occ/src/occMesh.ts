// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EdgeMeshData,
    EdgeMeshDataBuilder,
    FaceMeshData,
    FaceMeshDataBuilder,
    IShapeMeshData,
    MeshDataBuilder,
} from "chili-core";
import {
    Handle_Poly_Triangulation,
    Poly_Triangulation,
    TopAbs_Orientation,
    TopAbs_ShapeEnum,
    TopoDS_Edge,
    TopoDS_Face,
    gp_Trsf,
} from "../occ-wasm/chili_occ";

import { OccHelps } from "./occHelps";
import { OccShape } from "./occShape";

export class OccMesh implements IShapeMeshData {
    private maxDeviation: number = 8;
    private _lines?: EdgeMeshData;
    private _faces?: FaceMeshData;

    constructor(readonly shape: OccShape) {
        new occ.BRepMesh_IncrementalMesh_2(shape.shape, 0.1, false, 0.1, false);
    }

    updateMeshShape(): void {
        this.updateEdgeMeshShapes();
        this.updateFaceMeshShapes();
    }

    get edges(): EdgeMeshData | undefined {
        if (!this._lines) this._lines = this.edgeMeshs();
        return this._lines;
    }

    get faces(): FaceMeshData | undefined {
        if (!this._faces) this._faces = this.faceMeshs();
        return this._faces;
    }

    private edgeMeshs() {
        let shapes = OccHelps.findSubShapes(
            this.shape.shape,
            occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
            true,
        );
        let builder = new EdgeMeshDataBuilder();
        for (const e of shapes) {
            this.addEdgeMesh(e as TopoDS_Edge, builder);
        }
        let lines = builder.build();
        if (lines.positions.length === 0) return undefined;
        let matrix = OccHelps.convertToMatrix(this.shape.shape.Location_1().Transformation()).invert()!;
        lines.positions = matrix.ofPoints(lines.positions);
        return lines;
    }

    private updateEdgeMeshShapes() {
        if (!this._lines) return;
        let shapes = OccHelps.findSubShapes(
            this.shape.shape,
            occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
            true,
        );
        let i = 0;
        for (const shape of shapes) {
            this._lines.groups[i].shape = OccHelps.wrapShape(shape, this._lines.groups[i].shape.id);
            i++;
        }
    }

    private addEdgeMesh(edge: TopoDS_Edge, builder: EdgeMeshDataBuilder) {
        let adaptorCurve = new occ.BRepAdaptor_Curve_2(edge);
        let tangDef = new occ.GCPnts_TangentialDeflection_2(
            adaptorCurve,
            this.maxDeviation,
            0.1,
            2,
            1.0e-9,
            1.0e-7,
        );
        builder.newGroup();
        for (let i = 0; i < tangDef.NbPoints(); i++) {
            let vertex = tangDef.Value(i + 1);
            builder.addPosition(vertex.X(), vertex.Y(), vertex.Z());
        }
        builder.endGroup(OccHelps.wrapShape(edge));
    }

    private faceMeshs() {
        let shapes = OccHelps.findSubShapes(
            this.shape.shape,
            occ.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
            true,
        );
        let builder = new FaceMeshDataBuilder();
        for (const f of shapes) {
            this.addFaceMesh(f as TopoDS_Face, builder);
        }
        let faces = builder.build();
        if (faces.positions.length === 0) return undefined;
        let matrix = OccHelps.convertToMatrix(this.shape.shape.Location_1().Transformation()).invert()!;
        faces.positions = matrix.ofPoints(faces.positions);
        faces.normals = matrix.ofVectors(faces.normals);
        return faces;
    }

    private updateFaceMeshShapes() {
        if (!this._faces) return;
        let shapes = OccHelps.findSubShapes(
            this.shape.shape,
            occ.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
            true,
        );
        let i = 0;
        for (const shape of shapes) {
            this._faces.groups[i].shape = OccHelps.wrapShape(shape, this._faces.groups[i].shape.id);
            i++;
        }
    }

    private addFaceMesh(face: TopoDS_Face, builder: FaceMeshDataBuilder) {
        builder.newGroup();
        let location = new occ.TopLoc_Location_1();
        let handlePoly = occ.BRep_Tool.Triangulation(face, location, 0);
        if (handlePoly.IsNull()) return undefined;
        let poly = handlePoly.get();
        let trsf = location.Transformation();
        this.addNodes(poly, trsf, builder);
        this.addUVs(poly, builder);
        this.addTriangles(poly, face.Orientation_1(), builder);
        this.addNormals(handlePoly, trsf, face, poly.NbNodes(), builder);
        builder.endGroup(OccHelps.wrapShape(face));
    }

    private addTriangles(
        poly: Poly_Triangulation,
        orientation: TopAbs_Orientation,
        builder: FaceMeshDataBuilder,
    ) {
        for (let index = 1; index <= poly.NbTriangles(); index++) {
            let triangle = poly.Triangle(index);
            let [c1, c2, c3] = [triangle.Value(1) - 1, triangle.Value(2) - 1, triangle.Value(3) - 1];
            if (orientation === occ.TopAbs_Orientation.TopAbs_REVERSED) {
                builder.addIndices(c2, c1, c3);
            } else {
                builder.addIndices(c1, c2, c3);
            }
        }
    }

    private addUVs(poly: Poly_Triangulation, builder: FaceMeshDataBuilder) {
        let us = [],
            vs = [];
        for (let index = 1; index <= poly.NbNodes(); index++) {
            us.push(poly.UVNode(index).X());
            vs.push(poly.UVNode(index).Y());
        }
        let minU = Math.min(...us),
            maxU = Math.max(...us);
        let minV = Math.min(...vs),
            maxV = Math.max(...vs);
        for (let index = 0; index < us.length; index++) {
            builder.addUV((us[index] - minU) / (maxU - minU), (vs[index] - minV) / (maxV - minV));
        }
    }

    private addNodes(poly: Poly_Triangulation, transform: gp_Trsf, builder: MeshDataBuilder<any>) {
        for (let index = 1; index <= poly.NbNodes(); index++) {
            const pnt = poly.Node(index).Transformed(transform);
            builder.addPosition(pnt.X(), pnt.Y(), pnt.Z());
        }
    }

    private addNormals(
        poly: Handle_Poly_Triangulation,
        transform: gp_Trsf,
        face: TopoDS_Face,
        length: number,
        builder: FaceMeshDataBuilder,
    ) {
        let array = new occ.TColgp_Array1OfDir_2(1, length);
        let pc = new occ.Poly_Connect_2(poly);
        occ.StdPrs_ToolTriangulatedShape.Normal(face, pc, array);
        for (let i = 0; i < length; i++) {
            let normal = array.Value(i + 1).Transformed(transform);
            builder.addNormal(normal.X(), normal.Y(), normal.Z());
        }
    }
}
