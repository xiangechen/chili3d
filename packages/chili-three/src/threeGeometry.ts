// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EdgeMeshData,
    FaceMeshData,
    GeometryNode,
    IVisualGeometry,
    ShapeNode,
    VisualConfig,
} from "chili-core";
import { DoubleSide, Material, Mesh, MeshLambertMaterial } from "three";
import { MeshUtils } from "chili-geo";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";

export class ThreeGeometry extends ThreeVisualObject implements IVisualGeometry {
    private _faceMaterial: Material;
    private readonly _edgeMaterial = new LineMaterial({
        linewidth: 1,
        color: VisualConfig.defaultEdgeColor,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    private _edges?: LineSegments2;
    private _faces?: Mesh;

    getMainMaterial() {
        if (this._faces) return this._faceMaterial;
        return this._edgeMaterial;
    }

    changeFaceMaterial(material: Material) {
        if (this._faces) {
            this._faceMaterial = material;
            this._faces.material = material;
        }
    }

    constructor(
        readonly geometryNode: GeometryNode,
        readonly context: ThreeVisualContext,
    ) {
        super(geometryNode);
        this._faceMaterial = context.getMaterial(geometryNode.materialId);
        this.generateShape();
        geometryNode.onPropertyChanged(this.handleGeometryPropertyChanged);
    }

    box() {
        return this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox ?? undefined;
    }

    override boundingBox() {
        let box = this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
        let min = ThreeHelper.toXYZ(box!.min);
        let max = ThreeHelper.toXYZ(box!.max);
        return {
            min,
            max,
        };
    }

    private readonly handleGeometryPropertyChanged = (property: keyof GeometryNode) => {
        if (property === "materialId") {
            let material = this.context.getMaterial(this.geometryNode.materialId);
            this.changeFaceMaterial(material);
        } else if ((property as keyof ShapeNode) === "shape") {
            this.removeMeshes();
            this.generateShape();
        }
    };

    private generateShape() {
        let mesh = this.geometryNode.mesh;
        if (mesh?.faces?.positions.length) this.initFaces(mesh.faces);
        if (mesh?.edges?.positions.length) this.initEdges(mesh.edges);
    }

    override dispose() {
        super.dispose();
        this.removeMeshes();
        this.geometryNode.removePropertyChanged(this.handleGeometryPropertyChanged);
        this._edgeMaterial.dispose();
    }

    private removeMeshes() {
        if (this._edges) {
            this.remove(this._edges);
            this._edges.geometry.dispose();
            this._edges = undefined;
        }
        if (this._faces) {
            this.remove(this._faces);
            this._faces.geometry.dispose();
            this._faces = undefined;
        }
    }

    private initEdges(data: EdgeMeshData) {
        let buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        this._edges = new LineSegments2(buff, this._edgeMaterial);
        this.add(this._edges);
    }

    private initFaces(data: FaceMeshData) {
        let buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        this._faces = new Mesh(buff, this._faceMaterial);
        this.add(this._faces);
    }

    setFacesMateiralTemperary(material: MeshLambertMaterial) {
        if (this._faces) {
            this._faces.material = material;
        }
    }

    setEdgesMateiralTemperary(material: LineMaterial) {
        if (this._edges) {
            this._edges.material = material;
        }
    }

    removeTemperaryMaterial(): void {
        if (this._edges) this._edges.material = this._edgeMaterial;
        if (this._faces) this._faces.material = this._faceMaterial;
    }

    cloneSubEdge(index: number) {
        let positions = MeshUtils.subEdge(this.geometryNode.mesh.edges!, index);
        if (!positions) return undefined;

        let buff = new LineSegmentsGeometry();
        buff.setPositions(positions);
        buff.applyMatrix4(this.matrixWorld);

        return new LineSegments2(buff, this._edgeMaterial);
    }

    cloneSubFace(index: number) {
        let mesh = MeshUtils.subFace(this.geometryNode.mesh.faces!, index);
        if (!mesh) return undefined;

        let buff = ThreeGeometryFactory.createFaceBufferGeometry(mesh);
        buff.applyMatrix4(this.matrixWorld);

        return new Mesh(buff, this._faceMaterial);
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }
}
