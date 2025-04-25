// Part of the Chili3d Project, under the AGPL-3.0 Licensettt.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { Id } from "../foundation";
import { I18nKeys } from "../i18n";
import { BoundingBox, Matrix4, XYZ } from "../math";
import { Serializer } from "../serialize";
import { Mesh, MeshGroupLike } from "../shape";
import { MultiShapeMesh, ShapeNode } from "./shapeNode";
import { VisualNode } from "./visualNode";

export type MultiMesh = {
    shapes: {
        mesh: MultiShapeMesh;
        group: MeshGroupLike[];
    };
    meshes: Mesh;
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

    private _mesh?: MultiMesh;
    get mesh(): MultiMesh {
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

    private mergeMesh(): MultiMesh {
        const result: MultiMesh = {
            shapes: {
                mesh: new MultiShapeMesh(),
                group: [],
            },
            meshes: new Mesh(),
        };

        this.mergeNodesMesh(result, this._nodes, Matrix4.identity());

        return result;
    }

    private readonly mergeNodesMesh = (
        result: MultiMesh,
        nodes: Iterable<VisualNode>,
        transform: Matrix4,
    ) => {
        for (const node of nodes) {
            if (node instanceof ShapeNode && node.shape.isOk) {
                const start = result.shapes.mesh.faces?.index.length ?? 0;
                result.shapes.mesh.addShape(node.shape.value, transform);
                const end = result.shapes.mesh.faces?.index.length ?? 0;
                result.shapes.group.push({
                    start,
                    count: end - start,
                    materialId: node.materialId,
                });
            } else if (node instanceof ComponentNode) {
                this.mergeNodesMesh(result, node.component.nodes, node.transform.multiply(transform));
            } else {
                console.log(`****** to do merge MeshNode ******: ${Object.prototype.toString.call(node)}`);
            }
        }
    };

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
