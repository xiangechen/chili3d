// Part of the Chili3d Project, under the AGPL-3.0 Licensettt.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { IDocument } from "../document";
import { Id } from "../foundation";
import { I18nKeys } from "../i18n";
import { BoundingBox, Matrix4, XYZ } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { EdgeMeshData, FaceMeshData, LineType, Mesh } from "../shape";
import { MeshNode } from "./meshNode";
import { INode } from "./node";
import { ShapeNode } from "./shapeNode";
import { VisualNode } from "./visualNode";

export type ComponentMesh = {
    faceMaterials: string[];
    edge: EdgeMeshData;
    face: FaceMeshData;
    linesegments: Mesh;
    surfaceMaterials: string[];
    surface: Mesh;
};

export function createComponentMesh(size: ComponentSize): ComponentMesh {
    return {
        faceMaterials: [],
        edge: {
            lineType: LineType.Solid,
            position: new Float32Array(size.edge * 3),
            range: [],
        },
        face: {
            index: new Uint32Array(size.faceIndex),
            normal: new Float32Array(size.facePosition * 3),
            position: new Float32Array(size.facePosition * 3),
            uv: new Float32Array(size.facePosition * 2),
            range: [],
            groups: [],
        },
        linesegments: Mesh.createLineSegments(size.lineSegment),
        surfaceMaterials: [],
        surface: Mesh.createSurface(size.meshPosition, size.meshIndex > 0 ? size.meshIndex : size.meshPosition * 3),
    };
}

export type ComponentSize = {
    facePosition: number;
    faceIndex: number;
    edge: number;
    lineSegment: number;
    meshPosition: number;
    meshIndex: number;
};

export function createComponentSize(): ComponentSize {
    return {
        facePosition: 0,
        faceIndex: 0,
        edge: 0,
        lineSegment: 0,
        meshIndex: 0,
        meshPosition: 0,
    };
}

@Serializer.register(["name", "nodes", "origin", "id"])
export class Component {
    private readonly _nodes: ReadonlyArray<VisualNode>;
    @Serializer.serialze()
    get nodes(): ReadonlyArray<VisualNode> {
        return this._nodes;
    }

    private readonly _name: string;
    @Serializer.serialze()
    get name(): string {
        return this._name;
    }

    @Serializer.serialze()
    readonly id: string;

    private _origin: XYZ;
    @Serializer.serialze()
    get origin(): XYZ {
        return this._origin;
    }
    set origin(value: XYZ) {
        this._origin = value;
    }

    private _boundingBox?: BoundingBox;
    get boundingBox(): BoundingBox | undefined {
        this._boundingBox ??= this.computeBoundingBox();
        return this._boundingBox;
    }

    private _mesh?: ComponentMesh;
    get mesh(): ComponentMesh {
        this._mesh ??= this.mergeMesh();
        return this._mesh;
    }

    public instances: ComponentNode[] = [];

    constructor(name: string, nodes: ReadonlyArray<VisualNode>, origin?: XYZ, id = Id.generate()) {
        this._name = name;
        this._nodes = nodes;
        this.id = id;
        this._origin = origin ?? BoundingBox.center(this.boundingBox);
    }

    toString(): string {
        return this.name;
    }

    private mergeMesh() {
        const size: ComponentSize = createComponentSize();
        this.getSize(this._nodes, size);
        const mesh = createComponentMesh(size);

        const offset: ComponentSize = createComponentSize();
        const faceMaterialPair: [number, number][] = [];
        this.mergeNodesMesh(mesh, faceMaterialPair, this._nodes, Matrix4.identity(), offset);
        mesh.face = MeshUtils.mergeFaceMesh(mesh.face, faceMaterialPair);

        return mesh;
    }

    private getSize(nodes: Iterable<INode>, size: ComponentSize) {
        for (const node of nodes) {
            if (node instanceof ShapeNode && node.shape.isOk) {
                const mesh = node.shape.value.mesh;
                if (mesh.faces) {
                    size.facePosition += mesh.faces.position.length / 3;
                    size.faceIndex += mesh.faces.index.length;
                }
                if (mesh.edges) size.edge += mesh.edges.position.length / 3;
            } else if (node instanceof MeshNode) {
                size.meshPosition += node.mesh.position!.length / 3;
                if (node.mesh.meshType === "surface") {
                    size.meshIndex += node.mesh.index?.length ?? 0;
                }
            } else if (node instanceof ComponentNode) {
                this.getSize(node.component.nodes, size);
            }
        }
    }

    private readonly mergeNodesMesh = (
        visual: ComponentMesh,
        faceMaterialPair: [number, number][],
        nodes: Iterable<VisualNode>,
        transform: Matrix4,
        offset: ComponentSize,
    ) => {
        for (const node of nodes) {
            const totleTransform = node.transform.multiply(transform);
            if (node instanceof ShapeNode && node.shape.isOk) {
                this.mergeShapeNode(visual, faceMaterialPair, node, totleTransform, offset);
            } else if (node instanceof ComponentNode) {
                this.mergeNodesMesh(visual, faceMaterialPair, node.component.nodes, totleTransform, offset);
            } else if (node instanceof MeshNode) {
                this.mergeMeshNode(visual, node, totleTransform, offset);
            } else {
                console.log(`****** to do merge MeshNode ******: ${Object.prototype.toString.call(node)}`);
            }
        }
    };

    private mergeShapeNode(
        visual: ComponentMesh,
        faceMaterialPair: [number, number][],
        node: ShapeNode,
        transform: Matrix4,
        offset: ComponentSize,
    ) {
        const mesh = node.shape.value.mesh;
        if (mesh.edges) {
            MeshUtils.setEdgeMeshData(visual.edge, mesh.edges, transform, offset.edge);
            offset.edge += mesh.edges.position.length / 3;
        }
        if (mesh.faces) {
            this.mergeFaceMaterial(node, visual, faceMaterialPair);
            MeshUtils.setFaceMeshData(visual.face, mesh.faces, transform, offset);
            offset.facePosition += mesh.faces.position.length / 3;
            offset.faceIndex += mesh.faces.index.length;
        }
    }

    private mergeFaceMaterial(node: ShapeNode, visual: ComponentMesh, faceMaterialPair: [number, number][]) {
        const materialIndexMap = this.mapOldNewMaterialIndex(node.materialId, visual.faceMaterials);

        const map = new Map<number, number>(
            node.faceMaterialPair.map((pair) => [pair.faceIndex, pair.materialIndex]),
        );
        node.mesh.faces?.range.forEach((range, i) => {
            if (!map.has(i)) {
                faceMaterialPair.push([i + visual.face.range.length, materialIndexMap.get(0)!]);
            }
        });
        node.faceMaterialPair.forEach((pair) => {
            faceMaterialPair.push([
                pair.faceIndex + visual.face.range.length,
                materialIndexMap.get(pair.materialIndex)!,
            ]);
        });
    }

    private mergeMeshNode(
        visual: ComponentMesh,
        node: MeshNode,
        transform: Matrix4,
        offset: ComponentSize
    ) {
        if (node.mesh.meshType === "surface") {
            const materialONMap = this.mapOldNewMaterialIndex(node.materialId, visual.surfaceMaterials);
            MeshUtils.setSurfaceMeshData(visual.surface, node.mesh, transform, offset, materialONMap);
            offset.meshPosition += node.mesh.position!.length / 3;
            if (node.mesh.index?.length) {
                offset.meshIndex += node.mesh.index.length;
            }
        } else if (node.mesh.meshType === "linesegments") {
            visual.linesegments.position?.set(transform.ofPoints(node.mesh.position!), offset.lineSegment * 3);
            offset.lineSegment += node.mesh.position!.length / 3;
        }
    }

    private mapOldNewMaterialIndex(materialId: string | string[], materialIds: string[]) {
        const materialIndexMap = new Map<number, number>();
        const materials = Array.isArray(materialId) ? materialId : [materialId];
        for (let i = 0; i < materials.length; i++) {
            const index = materialIds.indexOf(materials[i]);
            if (index === -1) {
                materialIds.push(materials[i]);
                materialIndexMap.set(i, materialIds.length - 1);
            } else {
                materialIndexMap.set(i, index);
            }
        }

        return materialIndexMap;
    }

    private computeBoundingBox() {
        if (this._nodes.length === 0) {
            return undefined;
        }

        let box = this._nodes[0].boundingBox();
        for (let i = 1; i < this._nodes.length; i++) {
            box = BoundingBox.combine(box, this._nodes[i].boundingBox());
        }
        return box;
    }
}

@Serializer.register(["document", "name", "componentId", "insert", "id"])
export class ComponentNode extends VisualNode {
    override display(): I18nKeys {
        return "body.group";
    }

    override boundingBox(): BoundingBox | undefined {
        if (!this.component.boundingBox) {
            return undefined;
        }

        return BoundingBox.transformed(this.component.boundingBox, this.transform);
    }

    private _component?: Component;
    @Property.define("body.group")
    get component() {
        if (!this._component) {
            this._component = this.document.components.find((c) => c.id === this.componentId);
            if (!this._component) {
                throw new Error(`Component ${this.componentId} not found`);
            }
            this._component.instances.push(this);
        }
        return this._component;
    }

    @Serializer.serialze()
    readonly componentId: string;

    @Serializer.serialze()
    readonly insert: XYZ;

    constructor(
        document: IDocument,
        name: string,
        componentId: string,
        insert: XYZ,
        id: string = Id.generate(),
    ) {
        super(document, name, id);
        this.componentId = componentId;
        this.insert = insert;
    }
}
