// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, Constants, IModel, IShape, IShapeMesh, IVisualShape } from "chili-core";
import {
    BufferAttribute,
    BufferGeometry,
    Color as ThreeColor,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Object3D,
} from "three";
import { MeshBVH } from "three-mesh-bvh";

import { ThreeHelper } from "./threeHelper";

let edgeMaterial = new LineBasicMaterial();

let hilightEdgeMaterial = new LineBasicMaterial();
hilightEdgeMaterial.color.set(0xcfcf00);

let selectedEdgeMaterial = new LineBasicMaterial();
selectedEdgeMaterial.color.set(0xabab00);

let selectedColor = new ThreeColor(0.5, 0.8, 0.3);

export class ThreeShape extends Object3D implements IVisualShape {
    private _color: Color;
    private _faceMaterial: MeshBasicMaterial;
    private _wireMaterial: LineBasicMaterial;
    private _selectedStatus: boolean = false;
    transparency: number = 1;

    constructor(readonly shape: IShape) {
        super();
        this._wireMaterial = edgeMaterial;
        this._faceMaterial = new MeshBasicMaterial({
            color: 0xaaaaaa,
        });
        this._color = ThreeHelper.toColor(this._faceMaterial.color);
        this.init();
    }
    setColor(color: Color): void {
        throw new Error("Method not implemented.");
    }
    setTransparency(transparency: number): void {
        throw new Error("Method not implemented.");
    }

    private init() {
        let mesh = this.shape.mesh();
        let vertexGroup = this.initVertexs(mesh);
        let faceGroup = this.initFaces(mesh);
        let edgeGroup = this.initEdges(mesh);
        this.userData[Constants.ShapeKey] = this.shape;
        this.add(vertexGroup, edgeGroup, faceGroup);
    }

    private initVertexs(mesh: IShapeMesh) {
        let vertexGroup = new Group();

        return vertexGroup;
    }

    private initEdges(mesh: IShapeMesh) {
        let edgeGroup = new Group();

        mesh.edges.forEach((x) => {
            let buff = new BufferGeometry();
            buff.setAttribute("position", new Float32BufferAttribute(x.renderData.vertexs, 3));
            let line = new Line(buff, edgeMaterial);
            line.userData[Constants.ShapeKey] = x.edge;
            line.renderOrder = 1;
            edgeGroup.add(line);
        });

        return edgeGroup;
    }

    private initFaces(mesh: IShapeMesh) {
        let faceGroup = new Group();

        mesh.faces.forEach((x) => {
            let buff = new BufferGeometry();
            buff.setAttribute("position", new Float32BufferAttribute(x.renderData.vertexs, 3));
            buff.setAttribute("normals", new Float32BufferAttribute(x.renderData.normals, 3));
            buff.setIndex(x.renderData.indices);
            let g = new Mesh(buff, this._faceMaterial);
            g.userData[Constants.ShapeKey] = x.face;
            faceGroup.add(g);
        });

        return faceGroup;
    }

    selectedState() {
        if (this._selectedStatus) return;
        this._selectedStatus = true;
        this._wireMaterial = selectedEdgeMaterial;
        this.updateEdgeMaterial(selectedEdgeMaterial);
        this._color = ThreeHelper.toColor(this._faceMaterial.color);
        this._faceMaterial.color = selectedColor;
        // this._faceMaterial.transparent = true
        // this._faceMaterial.opacity = 0.5
    }

    unSelectedState() {
        if (!this._selectedStatus) return;
        this._selectedStatus = false;
        this._wireMaterial = edgeMaterial;
        this.updateEdgeMaterial(edgeMaterial);
        this._faceMaterial.color = ThreeHelper.fromColor(this.color);
        // this._faceMaterial.transparent = false
        // this._faceMaterial.opacity = 1
    }

    hilightedState() {
        this.updateEdgeMaterial(hilightEdgeMaterial);
    }

    unHilightedState() {
        this.updateEdgeMaterial(this._wireMaterial);
    }

    hilightedEdge(edge: Line) {
        edge.material = hilightEdgeMaterial;
    }

    unHilightedEdge(edge: Line) {
        edge.material = this._wireMaterial;
    }

    private updateEdgeMaterial(material: LineBasicMaterial) {
        this.wireframe()?.forEach((x) => (x.material = material));
    }

    set color(color: Color) {
        this._color = color;
        this._faceMaterial.color = ThreeHelper.fromColor(color);
    }

    get color(): Color {
        return this._color;
    }

    get isSelected() {
        return this._selectedStatus;
    }

    face(index: number): Mesh | undefined {
        return this.children.at(2)?.children.at(index) as Mesh;
    }

    faces() {
        return this.children.at(2)?.children.map((x) => x as Mesh);
    }

    edge(index: number): Line | undefined {
        return this.children.at(1)?.children.at(index) as Line;
    }

    wireframe() {
        return this.children.at(1)?.children.map((x) => x as Line);
    }
}
