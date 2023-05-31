// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, Constants, IModel, IShape, IShapeMeshData, IVisualShape } from "chili-core";
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
    LineSegments,
    DoubleSide,
    Float16BufferAttribute,
    Int32BufferAttribute,
} from "three";
import { MeshBVH } from "three-mesh-bvh";

import { ThreeHelper } from "./threeHelper";

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
        this._wireMaterial = new LineBasicMaterial();
        this._faceMaterial = new MeshBasicMaterial({
            color: 0xaaaaaa,
            side: DoubleSide,
            transparent: true,
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
        let faces = this.initFaces(mesh);
        let edges = this.initEdges(mesh);
        this.userData[Constants.ShapeKey] = this.shape;
        if (edges !== undefined) this.add(edges);
        if (faces !== undefined) this.add(faces);
    }

    private initEdges(mesh: IShapeMeshData) {
        if (mesh.edges === undefined) return undefined;
        let edgeMaterial = new LineBasicMaterial();
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(mesh.edges.positions, 3));
        buff.userData[Constants.GroupKey] = mesh.edges.groups;
        if (mesh.edges.color instanceof Array) {
            edgeMaterial.vertexColors = true;
            buff.setAttribute("color", new Float32BufferAttribute(mesh.edges.color, 3));
        } else {
            edgeMaterial.color = new ThreeColor(mesh.edges.color.toHexStr());
        }
        return new LineSegments(buff, edgeMaterial);
    }

    private initFaces(mesh: IShapeMeshData) {
        if (mesh.faces === undefined) return undefined;
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(mesh.faces.positions, 3));
        buff.setAttribute("normals", new Float32BufferAttribute(mesh.faces.normals, 3));
        buff.setIndex(mesh.faces.indices);
        buff.userData[Constants.GroupKey] = mesh.faces.groups;
        let g = new Mesh(buff, this._faceMaterial);
        // g.userData[Constants.ShapeKey] = mesh.;

        return g;
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
        //this._wireMaterial = edgeMaterial;
        //this.updateEdgeMaterial(edgeMaterial);
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
        let wire = this.edges();
        if (wire !== undefined) {
            wire.material = material;
        }
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

    // face(index: number): Mesh | undefined {
    //     return this.children.at(1)?.children.at(index) as Mesh;
    // }

    faces(): Mesh | undefined {
        return this.children.at(0) as Mesh;
    }

    // edge(index: number): Line | undefined {
    //     return this.children.at(0)?.children.at(index) as Line;
    // }

    edges(): LineSegments | undefined {
        return this.children.at(0) as LineSegments;
    }
}
