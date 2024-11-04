// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import {
    HistoryObservable,
    IDisposable,
    IEqualityComparer,
    IPropertyChanged,
    Id,
    PubSub,
    Result,
    debounce,
} from "../foundation";
import { I18n, I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { BoundingBox } from "../math/boundingBox";
import { Property } from "../property";
import { Serialized, Serializer } from "../serialize";
import { IShape, IShapeMeshData } from "../shape";

export interface INode extends IPropertyChanged, IDisposable {
    readonly id: string;
    visible: boolean;
    parentVisible: boolean;
    name: string;
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;
    clone(): this;
}

export interface INodeLinkedList extends INode {
    get firstChild(): INode | undefined;
    get lastChild(): INode | undefined;
    add(...items: INode[]): void;
    remove(...items: INode[]): void;
    size(): number;
    insertAfter(target: INode | undefined, node: INode): void;
    insertBefore(target: INode | undefined, node: INode): void;
    move(child: INode, newParent: this, newPreviousSibling?: INode): void;
}

export namespace INode {
    export function isLinkedListNode(node: INode): node is INodeLinkedList {
        return (node as INodeLinkedList).add !== undefined;
    }
}

export abstract class Node extends HistoryObservable implements INode {
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;

    @Serializer.serialze()
    readonly id: string;

    constructor(document: IDocument, name: string, id: string) {
        super(document);
        this.id = id;
        this.setPrivateValue("name", name);
    }

    @Serializer.serialze()
    @Property.define("common.name")
    get name() {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @Serializer.serialze()
    get visible(): boolean {
        return this.getPrivateValue("visible", true);
    }
    set visible(value: boolean) {
        this.setProperty("visible", value, () => this.onVisibleChanged());
    }

    protected abstract onVisibleChanged(): void;

    get parentVisible() {
        return this.getPrivateValue("parentVisible", true);
    }
    set parentVisible(value: boolean) {
        this.setProperty("parentVisible", value, () => this.onParentVisibleChanged());
    }

    clone(): this {
        let serialized = Serializer.serializeObject(this);
        serialized.properties["id"] = Id.generate();
        serialized.properties["name"] = `${this.name}_copy`;
        let cloned: this = Serializer.deserializeObject(this.document, serialized);
        this.parent?.add(cloned);
        return cloned;
    }

    protected abstract onParentVisibleChanged(): void;
}

export namespace INode {
    export function getNodesBetween(node1: INode, node2: INode): INode[] {
        if (node1 === node2) return [node1];
        let nodes: INode[] = [];
        let prePath = getPathToRoot(node1);
        let curPath = getPathToRoot(node2);
        let index = getCommonParentIndex(prePath, curPath);
        let parent = prePath.at(1 - index) as INodeLinkedList;
        if (parent === curPath[0] || parent === prePath[0]) {
            let child = parent === curPath[0] ? prePath[0] : curPath[0];
            getNodesFromParentToChild(nodes, parent, child);
        } else if (currentAtBack(prePath.at(-index)!, curPath.at(-index)!)) {
            getNodesFromPath(nodes, prePath, curPath, index);
        } else {
            getNodesFromPath(nodes, curPath, prePath, index);
        }
        return nodes;
    }

    function getNodesFromPath(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        nodeOrChildrenAppendToNodes(nodes, path1[0]);
        path1ToCommonNodes(nodes, path1, commonIndex);
        commonToPath2Nodes(nodes, path1, path2, commonIndex);
    }

    function path1ToCommonNodes(nodes: INode[], path1: INode[], commonIndex: number) {
        for (let i = 0; i < path1.length - commonIndex; i++) {
            let next = path1[i].nextSibling;
            while (next !== undefined) {
                INode.nodeOrChildrenAppendToNodes(nodes, next);
                next = next.nextSibling;
            }
        }
    }

    function commonToPath2Nodes(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        let nextParent = path1.at(-commonIndex)?.nextSibling;
        while (nextParent) {
            if (nextParent === path2[0]) {
                nodes.push(path2[0]);
                return;
            }
            if (INode.isLinkedListNode(nextParent)) {
                if (getNodesFromParentToChild(nodes, nextParent, path2[0])) {
                    return;
                }
            } else {
                nodes.push(nextParent);
            }
            nextParent = nextParent.nextSibling;
        }
    }

    export function nodeOrChildrenAppendToNodes(nodes: INode[], node: INode) {
        if (INode.isLinkedListNode(node)) {
            getNodesFromParentToChild(nodes, node);
        } else {
            nodes.push(node);
        }
    }

    export function findTopLevelNodes(nodes: Set<INode>) {
        let result: INode[] = [];
        for (const node of nodes) {
            if (!containsDescendant(nodes, node)) {
                result.push(node);
            }
        }
        return result;
    }

    export function containsDescendant(nodes: Set<INode>, node: INode): boolean {
        if (node.parent === undefined) return false;
        if (nodes.has(node.parent)) return true;
        return containsDescendant(nodes, node.parent);
    }

    function getNodesFromParentToChild(nodes: INode[], parent: INodeLinkedList, until?: INode): boolean {
        nodes.push(parent);
        let node = parent.firstChild;
        while (node !== undefined) {
            if (until === node) {
                nodes.push(node);
                return true;
            }

            if (INode.isLinkedListNode(node)) {
                if (getNodesFromParentToChild(nodes, node, until)) return true;
            } else {
                nodes.push(node);
            }
            node = node.nextSibling;
        }
        return false;
    }

    function currentAtBack(preNode: INode, curNode: INode) {
        while (preNode.nextSibling !== undefined) {
            if (preNode.nextSibling === curNode) return true;
            preNode = preNode.nextSibling;
        }
        return false;
    }

    function getCommonParentIndex(prePath: INode[], curPath: INode[]) {
        let index = 1;
        for (index; index <= Math.min(prePath.length, curPath.length); index++) {
            if (prePath.at(-index) !== curPath.at(-index)) break;
        }
        if (prePath.at(1 - index) !== curPath.at(1 - index)) throw new Error("can not find a common parent");
        return index;
    }

    function getPathToRoot(node: INode): INode[] {
        let path: INode[] = [];
        let parent: INode | undefined = node;
        while (parent !== undefined) {
            path.push(parent);
            parent = parent.parent;
        }
        return path;
    }
}

export interface IMeshObject extends IPropertyChanged {
    materialId: string;
    matrix: Matrix4;
    boundingBox(): BoundingBox;
    get mesh(): IShapeMeshData;
}

export abstract class GeometryNode extends Node implements IMeshObject {
    @Serializer.serialze()
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string) {
        this.setProperty("materialId", value);
    }

    @Serializer.serialze()
    get matrix(): Matrix4 {
        return this.getPrivateValue("matrix", Matrix4.identity());
    }
    set matrix(value: Matrix4) {
        this.setProperty(
            "matrix",
            value,
            (_p, oldMatrix) => {
                this.onMatrixChanged(value, oldMatrix);
                this._boundingBox = undefined;
            },
            {
                equals: (left, right) => left.equals(right),
            },
        );
    }

    constructor(document: IDocument, name: string, materialId?: string, id: string = Id.generate()) {
        super(document, name, id);
        this.setPrivateValue("materialId", materialId ?? document.materials.at(0)?.id ?? "");
    }

    protected _boundingBox: BoundingBox | undefined;
    boundingBox(): BoundingBox {
        if (this._boundingBox === undefined) {
            let points = this.mesh.faces?.positions ?? this.mesh.edges?.positions ?? [];
            points = this.matrix.ofPoints(points);
            this._boundingBox = BoundingBox.fromNumbers(points);
        }
        return this._boundingBox;
    }

    protected onMatrixChanged(newMatrix: Matrix4, oldMatrix: Matrix4): void {}

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        if (this._mesh === undefined) {
            this._mesh = this.createMesh();
        }
        return this._mesh;
    }

    protected abstract createMesh(): IShapeMeshData;
}

export abstract class ShapeNode extends GeometryNode {
    protected _shape: Result<IShape> = Result.err(SHAPE_UNDEFINED);
    get shape(): Result<IShape> {
        return this._shape;
    }

    protected setShape(shape: Result<IShape>) {
        if (this._shape.isOk && this._shape.isOk && this._shape.value.isEqual(shape.value)) {
            return;
        }

        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
            return;
        }

        let oldShape = this._shape;
        this._shape = shape;
        this._mesh = undefined;
        this._boundingBox = undefined;
        this._shape.value.matrix = this.matrix;
        this.emitPropertyChanged("shape", oldShape);
    }

    protected override onMatrixChanged(newMatrix: Matrix4): void {
        if (this.shape.isOk) this.shape.value.matrix = newMatrix;
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            throw new Error(this.shape.error);
        }
        return this.shape.value.mesh;
    }

    override dispose(): void {
        super.dispose();
        this.shape.unchecked()?.dispose();
    }
}

const SHAPE_UNDEFINED = "Shape not initialized";
export abstract class ParameterShapeNode extends ShapeNode {
    override get shape(): Result<IShape> {
        if (!this._shape.isOk && this._shape.error === SHAPE_UNDEFINED) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }

    protected setPropertyEmitShapeChanged<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this.setShape(this.generateShape());
            return true;
        }

        return false;
    }

    constructor(document: IDocument, materialId?: string, id?: string) {
        super(document, undefined as any, materialId, id);
        this.name = I18n.translate(this.display());
    }

    protected abstract generateShape(): Result<IShape>;
    abstract display(): I18nKeys;
}

@Serializer.register(["document", "name", "shape", "materialId", "id"])
export class EditableShapeNode extends ShapeNode {
    @Serializer.serialze()
    override get shape(): Result<IShape> {
        return this._shape;
    }
    override set shape(shape: Result<IShape>) {
        this.setShape(shape);
    }

    constructor(document: IDocument, name: string, shape: IShape, materialId?: string, id?: string) {
        super(document, name, materialId, id);
        this._shape = Result.ok(shape);
    }
}

export namespace NodeSerializer {
    export function serialize(node: INode) {
        let nodes: Serialized[] = [];
        serializeNodeToArray(nodes, node, undefined);
        return nodes;
    }

    function serializeNodeToArray(nodes: Serialized[], node: INode, parentId: string | undefined) {
        let serialized: any = Serializer.serializeObject(node);
        if (parentId) serialized["parentId"] = parentId;
        nodes.push(serialized);

        if (INode.isLinkedListNode(node) && node.firstChild) {
            serializeNodeToArray(nodes, node.firstChild, node.id);
        }
        if (node.nextSibling) {
            serializeNodeToArray(nodes, node.nextSibling, parentId);
        }
        return nodes;
    }

    export function deserialize(document: IDocument, nodes: Serialized[]) {
        let nodeMap: Map<string, INodeLinkedList> = new Map();
        nodes.forEach((n) => {
            let node = Serializer.deserializeObject(document, n);
            if (INode.isLinkedListNode(node)) {
                nodeMap.set(n.properties["id"], node);
            }
            let parentId = (n as any)["parentId"];
            if (!parentId) return;
            if (nodeMap.has(parentId)) {
                nodeMap.get(parentId)!.add(node);
            } else {
                console.warn("parent not found: " + parentId);
            }
        });
        return nodeMap.get(nodes[0].properties["id"]);
    }
}
