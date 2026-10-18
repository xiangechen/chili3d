// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id } from "../foundation";
import { I18n, type I18nKeys } from "../i18n";
import type { Matrix4 } from "../math";
import { Serializer, serializable, serialize } from "../serialize";
import { Mesh } from "../shape";
import { MeshNode } from "./meshNode";

export interface MeshInstanceNodeOptions {
    document: IDocument;
    /** The mesh node whose geometry this instance places. */
    sourceId: string;
    name?: string;
    transform?: Matrix4;
    materialId?: string | string[];
    id?: string;
}

/**
 * A placed copy of a `MeshNode` — the mesh counterpart of `BodyInstanceNode`.
 *
 * It stores no mesh of its own: `mesh` reads the source's, and `ThreeMeshObject` renders
 * that through this node's transform. The serialized form deliberately omits `mesh`
 * (the base `MeshNode` field), so an instance never duplicates geometry in the document.
 */
@serializable({
    serialize: (target: MeshInstanceNode) => {
        return Serializer.serializeProperties(target, new Set(["mesh"]));
    },
})
export class MeshInstanceNode extends MeshNode {
    get isInstance(): true {
        return true;
    }

    /** Copying an instance copies its placement; it must not nest another instance. */
    override get copiesAsInstance(): boolean {
        return false;
    }

    /** The copy Move/Array/Copy make for a `MeshNode` source. */
    static fromSource(source: MeshNode, transform: Matrix4): MeshInstanceNode {
        return new MeshInstanceNode({
            document: source.document,
            sourceId: source.id,
            name: `${source.name}_copy`,
            materialId: Array.isArray(source.materialId) ? [...source.materialId] : source.materialId,
            transform: source.transform.multiply(transform),
        });
    }

    override display(): I18nKeys {
        return "body.instance";
    }

    get icon(): string {
        return "icon-copy";
    }

    /** `INodeWarning`: the tree badges a placement whose source is gone. */
    get warningCount(): number {
        return this.source === undefined ? 1 : 0;
    }

    get warningTooltip(): I18nKeys {
        return "body.instance.sourceMissing";
    }

    /** Mutable so a replacement of the source node can retarget every instance. */
    @serialize()
    get sourceId(): string {
        return this.getPrivateValue("sourceId");
    }
    set sourceId(value: string) {
        if (this.sourceId === value) return;
        this.setProperty("sourceId", value);
    }

    private _source?: MeshNode;
    private _watched?: MeshNode;

    constructor(options: MeshInstanceNodeOptions) {
        super({
            document: options.document,
            name: options.name ?? I18n.translate("body.instance"),
            // The proxy replaces this as soon as the source resolves; it only backs the
            // "source is gone" case so the renderer still gets a valid empty mesh.
            mesh: Mesh.createSurface(0, 0),
            materialId: Array.isArray(options.materialId) ? [...options.materialId] : options.materialId,
            id: options.id ?? Id.generate(),
        });
        this.setPrivateValue("sourceId", options.sourceId);
        // Undo/redo assigns `sourceId` through the public setter, which emits this event
        // (`setPrivateValue` alone emits nothing — retargeting must use the setter).
        this.onPropertyChanged(this.handleSourceIdChanged);
        if (options.transform !== undefined) this.transform = options.transform;
    }

    get source(): MeshNode | undefined {
        // Same lifetime rules as `BodyInstanceNode`: cache a live source, re-resolve a
        // disposed one, and reach nodes moved into a Component definition.
        if (this._source !== undefined && !this._source.isDisposed) return this._source;
        this._source = undefined;

        const found = this.document.modelManager.findNodeDeep((x) => x.id === this.sourceId);
        const source = found === this || (found instanceof MeshNode && found.isDisposed) ? undefined : found;
        const next = source instanceof MeshNode ? source : undefined;
        if (next !== this._watched) this.watch(next);
        return this._source;
    }

    override get mesh(): Mesh {
        return this.source?.mesh ?? this._mesh;
    }

    /** The source owns the mesh; an instance never replaces it. */
    override set mesh(_value: Mesh) {}

    override disposeInternal(): void {
        this._watched?.removePropertyChanged(this.onSourceMeshChanged);
        this._watched = undefined;
        this._source = undefined;
        super.disposeInternal();
    }

    private watch(source: MeshNode | undefined): void {
        const hadSource = this._watched !== undefined;
        this._watched?.removePropertyChanged(this.onSourceMeshChanged);
        this._watched = source;
        this._source = source;
        source?.onPropertyChanged(this.onSourceMeshChanged);
        if (hadSource !== (source !== undefined)) {
            this.emitPropertyChanged("warningCount", hadSource ? 0 : 1);
        }
    }

    /** A source mesh swap invalidates the render; `ThreeMeshObject` listens for `mesh`. */
    private readonly onSourceMeshChanged = (property: keyof MeshNode) => {
        if (property !== "mesh") return;
        this.emitPropertyChanged("mesh", this._mesh);
    };

    /** A retarget (including undo/redo) drops the cached source and refreshes the render. */
    private readonly handleSourceIdChanged = (property: PropertyKey) => {
        if (property !== "sourceId") return;
        this.watch(undefined);
        this.emitPropertyChanged("mesh", this._mesh);
    };
}
