// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { EdgeMesh, FaceMesh, IShapeMesh, RenderDataBuilder, VertexMesh, VertexRenderData } from "chili-core";
import {
    Handle_Poly_Triangulation,
    Poly_Triangulation,
    TopAbs_Orientation,
    TopAbs_ShapeEnum,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
} from "opencascade.js";

import { OccHelps } from "./occHelps";
import { OccEdge, OccFace, OccVertex } from "./occShape";

export class OccMesh implements IShapeMesh {
    private maxDeviation: number;
    private _vertexs: VertexMesh[] = [];
    private _lines: EdgeMesh[] = [];
    private _faces: FaceMesh[] = [];

    constructor(readonly shape: TopoDS_Shape) {
        this.maxDeviation = 8;
        new occ.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.1, false);
        this._mesh(shape);
    }

    get vertexs(): VertexMesh[] {
        return this._vertexs;
    }
    get edges(): EdgeMesh[] {
        return this._lines;
    }
    get faces(): FaceMesh[] {
        return this._faces;
    }

    private _mesh(shape: TopoDS_Shape) {
        let shapeType = shape.ShapeType();
        if (shapeType === occ.TopAbs_ShapeEnum.TopAbs_VERTEX) {
            this.pointMesh(shape);
            return;
        }
        if (shapeType !== occ.TopAbs_ShapeEnum.TopAbs_EDGE) {
            this.faceMeshs();
        }
        this.edgeMeshs(shape);
    }

    private pointMesh(shape: TopoDS_Shape) {
        let vertex = occ.TopoDS.Vertex_1(shape);
        let pnt = occ.BRep_Tool.Pnt(vertex);
        this._vertexs.push({
            vertex: new OccVertex(vertex),
            renderData: VertexRenderData.from(OccHelps.toXYZ(pnt)),
        });
    }

    private edgeMeshs(shape: TopoDS_Shape) {
        let ex = new occ.TopExp_Explorer_2(
            shape,
            occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
            occ.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
        );
        while (ex.More()) {
            let edge = occ.TopoDS.Edge_1(ex.Current());
            if (edge !== undefined) this.getEdgeMesh(edge);
            ex.Next();
        }
    }

    private getEdgeMesh(edge: TopoDS_Edge) {
        let adaptorCurve = new occ.BRepAdaptor_Curve_2(edge);
        let tangDef = new occ.GCPnts_TangentialDeflection_2(
            adaptorCurve,
            this.maxDeviation,
            0.1,
            2,
            1.0e-9,
            1.0e-7
        );
        let builder = new RenderDataBuilder();
        for (let i = 0; i < tangDef.NbPoints(); i++) {
            let vertex = tangDef.Value(i + 1);
            builder.addVertex(vertex.X(), vertex.Y(), vertex.Z());
        }
        this._lines.push({
            edge: new OccEdge(edge),
            renderData: builder.buildEdge(),
        });
    }

    private faceMeshs() {
        let ex = new occ.TopExp_Explorer_2(
            this.shape,
            occ.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
            occ.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
        );
        while (ex.More()) {
            let face = occ.TopoDS.Face_1(ex.Current());
            this.getFaceMesh(face);
            ex.Next();
        }
    }

    private getFaceMesh(face: TopoDS_Face) {
        let location = new occ.TopLoc_Location_1();
        let handlePoly = occ.BRep_Tool.Triangulation(face, location, undefined);
        if (handlePoly.IsNull()) return undefined;
        let poly = handlePoly.get();
        let builder = new RenderDataBuilder();
        this.addNodes(poly, builder);
        this.addTriangles(poly, face.Orientation_1(), builder);
        this.addNormals(handlePoly, face, poly.NbNodes(), builder);
        this._faces.push({
            face: new OccFace(face),
            renderData: builder.buildFace(),
        });
    }

    private addTriangles(
        poly: Poly_Triangulation,
        orientation: TopAbs_Orientation,
        builder: RenderDataBuilder
    ) {
        for (let index = 1; index <= poly.NbTriangles(); index++) {
            let triangle = poly.Triangle(index);
            if (orientation === occ.TopAbs_Orientation.TopAbs_REVERSED) {
                builder.addIndices(triangle.Value(1) - 1, triangle.Value(3) - 1, triangle.Value(2) - 1);
            } else {
                builder.addIndices(triangle.Value(1) - 1, triangle.Value(2) - 1, triangle.Value(3) - 1);
            }
        }
    }

    private addNodes(poly: Poly_Triangulation, builder: RenderDataBuilder) {
        for (let index = 1; index <= poly.NbNodes(); index++) {
            const pnt = poly.Node(index);
            builder.addVertex(pnt.X(), pnt.Y(), pnt.Z());
        }
    }

    private addNormals(
        poly: Handle_Poly_Triangulation,
        face: TopoDS_Face,
        length: number,
        builder: RenderDataBuilder
    ) {
        let array = new occ.TColgp_Array1OfDir_2(1, length);
        let pc = new occ.Poly_Connect_2(poly);
        occ.StdPrs_ToolTriangulatedShape.Normal(face, pc, array);
        for (let i = 0; i < length; i++) {
            let normal = array.Value(i + 1);
            builder.addNormal(normal.X(), normal.Y(), normal.Z());
        }
    }
}
