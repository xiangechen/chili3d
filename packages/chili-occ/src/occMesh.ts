// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    EdgeMeshData,
    IShape,
    VertexMeshData,
    FaceMeshData,
    IShapeMeshData,
    MeshDataBuilder,
    FaceMeshDataBuilder,
    EdgeMeshDataBuilder,
} from "chili-core";
import {
    Handle_Poly_Triangulation,
    Poly_Triangulation,
    TopAbs_Orientation,
    TopAbs_ShapeEnum,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    gp_Trsf,
} from "opencascade.js";

import { OccHelps } from "./occHelps";

export class OccMesh implements IShapeMeshData {
    private maxDeviation: number;
    private _vertexs?: VertexMeshData;
    private _lines?: EdgeMeshData;
    private _faces?: FaceMeshData;
    readonly shape: IShape;

    constructor(readonly ocShape: TopoDS_Shape) {
        this.maxDeviation = 8;
        this.shape = OccHelps.getShape(ocShape);
        new occ.BRepMesh_IncrementalMesh_2(ocShape, 0.1, false, 0.1, false);
        this._mesh(ocShape);
    }

    get vertexs(): VertexMeshData | undefined {
        return this._vertexs;
    }
    get edges(): EdgeMeshData | undefined {
        return this._lines;
    }
    get faces(): FaceMeshData | undefined {
        return this._faces;
    }

    private _mesh(shape: TopoDS_Shape) {
        let shapeType = shape.ShapeType();
        if (shapeType === occ.TopAbs_ShapeEnum.TopAbs_VERTEX) {
            this.pointMesh(shape);
            return;
        }
        if (shapeType !== occ.TopAbs_ShapeEnum.TopAbs_EDGE) {
            this.faceMeshs(shape);
        }

        this.edgeMeshs(shape);
    }

    private pointMesh(shape: TopoDS_Shape) {
        console.log("暂不支持");
    }

    private edgeMeshs(shape: TopoDS_Shape) {
        let shapes = OccHelps.findSubShapes(
            shape,
            occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
            true
        );
        let builder = new EdgeMeshDataBuilder();
        for (const shape of shapes) {
            let edge = occ.TopoDS.Edge_1(shape);
            this.addEdgeMesh(edge, builder);
        }
        this._lines = builder.build();
    }

    private addEdgeMesh(edge: TopoDS_Edge, builder: EdgeMeshDataBuilder) {
        let adaptorCurve = new occ.BRepAdaptor_Curve_2(edge);
        let tangDef = new occ.GCPnts_TangentialDeflection_2(
            adaptorCurve,
            this.maxDeviation,
            0.1,
            2,
            1.0e-9,
            1.0e-7
        );
        builder.newGroup();
        for (let i = 0; i < tangDef.NbPoints(); i++) {
            let vertex = tangDef.Value(i + 1);
            builder.addPosition(vertex.X(), vertex.Y(), vertex.Z());
        }
        builder.endGroup(OccHelps.getShape(edge));
    }

    private faceMeshs(shape: TopoDS_Shape) {
        let shapes = OccHelps.findSubShapes(
            shape,
            occ.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
            true
        );
        let builder = new FaceMeshDataBuilder();
        for (const shape of shapes) {
            let face = occ.TopoDS.Face_1(shape);
            this.addFaceMesh(face, builder);
        }
        this._faces = builder.build();
    }

    private addFaceMesh(face: TopoDS_Face, builder: FaceMeshDataBuilder) {
        builder.newGroup();
        let location = new occ.TopLoc_Location_1();
        let handlePoly = occ.BRep_Tool.Triangulation(face, location, 0);
        if (handlePoly.IsNull()) return undefined;
        let transform = location.Transformation();
        let poly = handlePoly.get();
        this.addNodes(poly, transform, builder);
        this.addTriangles(poly, face.Orientation_1(), builder);
        this.addNormals(handlePoly, transform, face, poly.NbNodes(), builder);
        builder.endGroup(OccHelps.getShape(face));
    }

    private addTriangles(
        poly: Poly_Triangulation,
        orientation: TopAbs_Orientation,
        builder: FaceMeshDataBuilder
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
        builder: FaceMeshDataBuilder
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
