// Part of the Chili3d Project, under the AGPL-3.0 Licensettt.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { IDocument } from "../document";
import { Id } from "../foundation";
import { I18nKeys } from "../i18n";
import { BoundingBox, Matrix4, XYZ } from "../math";
import { Serializer } from "../serialize";
import { EdgeMeshData, FaceMeshData, LineType, Mesh } from "../shape";
import { ShapeNode } from "./shapeNode";
import { VisualNode } from "./visualNode";

export type ComponentMesh = {
    faceMaterials: string[];
    edge: EdgeMeshData;
    face: FaceMeshData;
    line: Mesh;
    surfaceMaterials: string[];
    surface: Mesh;
};

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

    private mergeMesh() {
        const mesh: ComponentMesh = {
            faceMaterials: [],
            edge: {
                lineType: LineType.Solid,
                position: new Float32Array(),
                range: [],
            },
            face: {
                index: [],
                normal: new Float32Array(),
                position: new Float32Array(),
                uv: new Float32Array(),
                range: [],
                groups: [],
            },
            line: Mesh.createLine(),
            surfaceMaterials: [],
            surface: Mesh.createSurface(),
        };
        const faceMaterialPair: [number, number][] = [];
        this.mergeNodesMesh(mesh, faceMaterialPair, this._nodes, Matrix4.identity());
        mesh.face = MeshUtils.mergeFaceMesh(mesh.face, faceMaterialPair);

        return mesh;
    }

    private readonly mergeNodesMesh = (
        visual: ComponentMesh,
        faceMaterialPair: [number, number][],
        nodes: Iterable<VisualNode>,
        transform: Matrix4,
    ) => {
        for (const node of nodes) {
            if (node instanceof ShapeNode && node.shape.isOk) {
                this.mergeShapeNode(visual, faceMaterialPair, node, node.transform.multiply(transform));
            } else if (node instanceof ComponentNode) {
                this.mergeNodesMesh(
                    visual,
                    faceMaterialPair,
                    node.component.nodes,
                    node.transform.multiply(transform),
                );
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
    ) {
        const mesh = node.shape.value.mesh;
        if (mesh.edges) MeshUtils.combineEdgeMeshData(visual.edge, mesh.edges, transform);
        if (mesh.faces) {
            this.mergeMaterial(node, visual, faceMaterialPair);
            MeshUtils.combineFaceMeshData(visual.face, mesh.faces, transform);
        }
    }

    private mergeMaterial(node: ShapeNode, visual: ComponentMesh, faceMaterialPair: [number, number][]) {
        const materialIndexMap = new Map<number, number>();
        const materials = Array.isArray(node.materialId) ? node.materialId : [node.materialId];
        for (let i = 0; i < materials.length; i++) {
            const index = visual.faceMaterials.indexOf(materials[i]);
            if (index === -1) {
                visual.faceMaterials.push(materials[i]);
                materialIndexMap.set(i, visual.faceMaterials.length - 1);
            } else {
                materialIndexMap.set(i, index);
            }
        }

        const map = new Map<number, number>(node.faceMaterialPair);
        node.mesh.faces?.range.forEach((range, i) => {
            if (!map.has(i)) {
                faceMaterialPair.push([i + visual.face.range.length, materialIndexMap.get(0)!]);
            }
        });
        node.faceMaterialPair.forEach((pair) => {
            faceMaterialPair.push([pair[0] + visual.face.range.length, materialIndexMap.get(pair[1])!]);
        });
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
        return "arc.angle";
    }

    override boundingBox(): BoundingBox | undefined {
        if (!this.component.boundingBox) {
            return undefined;
        }

        return BoundingBox.transformed(this.component.boundingBox, this.transform);
    }

    private _component?: Component;
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
