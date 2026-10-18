// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id, Result } from "../foundation";
import { I18n, type I18nKeys } from "../i18n";
import type { Matrix4 } from "../math";
import { serializable, serialize } from "../serialize";
import type { IShape, IShapeMeshData } from "../shape";
import { MeshUtils } from "../shape/meshUtils";
import { FaceMaterialPair } from "./geometryNode";
import { ShapeNode } from "./shapeNode";

export interface BodyInstanceNodeOptions {
    document: IDocument;
    /** The node whose geometry this instance places. */
    sourceId: string;
    name?: string;
    transform?: Matrix4;
    /** Carried over from the source so a copy keeps its paint. */
    materialId?: string | string[];
    /** Per-face material overrides, carried over from the source. */
    faceMaterialPair?: FaceMaterialPair[];
    id?: string;
}

/**
 * A placed copy of another shape node — the assembly "instance" of a body.
 *
 * It owns no geometry and no feature list: it reads the source's shape and renders it
 * through its own `transform`. That is what makes an instance the right copy semantics
 * for a parametric body: editing the source's sketch or features updates every instance,
 * while moving an instance changes only its placement. `Detach` turns one into an
 * independent deep copy when that is not what the user wants.
 *
 * The node never disposes the source shape, and it rebuilds its mesh when the source's
 * shape changes (`ShapeNode` disposes what it owns, so the source stays excluded).
 */
@serializable()
export class BodyInstanceNode extends ShapeNode {
    /** `IInstanceNode`: commands treat this as a placement of `sourceId`. */
    get isInstance(): true {
        return true;
    }

    /** The copy Move/Array/Copy make for a `ShapeNode` source. */
    static fromSource(source: ShapeNode, transform: Matrix4): BodyInstanceNode {
        return new BodyInstanceNode({
            document: source.document,
            sourceId: source.id,
            name: `${source.name}_copy`,
            materialId: Array.isArray(source.materialId) ? [...source.materialId] : source.materialId,
            faceMaterialPair: source.faceMaterialPair,
            transform: source.transform.multiply(transform),
        });
    }

    override display(): I18nKeys {
        return "body.instance";
    }

    override get icon(): string {
        return "icon-copy";
    }

    /** The source's type, not this node's never-assigned `_shape` placeholder. */
    override get shapeType(): string {
        return this.source?.shapeType ?? I18n.translate("body.instance");
    }

    /** `INodeWarning`: the tree badges a placement whose source is gone. */
    get warningCount(): number {
        return this.source === undefined ? 1 : 0;
    }

    get warningTooltip(): I18nKeys {
        return "body.instance.sourceMissing";
    }

    /**
     * The source's id. Mutable on purpose: a destructive command that replaces the
     * source node (a fillet on a primitive) retargets every instance to the new node,
     * so the placement keeps following the definition. The setter is undoable.
     */
    @serialize()
    get sourceId(): string {
        return this.getPrivateValue("sourceId");
    }
    set sourceId(value: string) {
        if (this.sourceId === value) return;
        this.setProperty("sourceId", value);
    }

    private _source?: ShapeNode;
    /** The node currently subscribed to; may outlive a resolved `_source`. */
    private _watched?: ShapeNode;

    constructor(options: BodyInstanceNodeOptions) {
        super({
            document: options.document,
            name: options.name,
            // A new array: painting the instance must not push into the source's list.
            materialId: Array.isArray(options.materialId) ? [...options.materialId] : options.materialId,
            id: options.id ?? Id.generate(),
        });
        this.setPrivateValue("sourceId", options.sourceId);
        // Listen rather than act in the setter: undo/redo assigns `sourceId` through the
        // public setter, which emits this same event while bypassing the setter's own
        // body. (`setPrivateValue` alone emits nothing — retargeting must use the setter.)
        this.onPropertyChanged(this.handleSourceIdChanged);
        if (options.faceMaterialPair !== undefined) {
            // Copy the pair OBJECTS too: `removeFaceMaterial` edits `materialIndex` in
            // place, and sharing one with the source would repaint the source.
            this.setPrivateValue(
                "faceMaterialPair",
                options.faceMaterialPair.map(
                    (pair) =>
                        new FaceMaterialPair({
                            faceIndex: pair.faceIndex,
                            materialIndex: pair.materialIndex,
                        }),
                ),
            );
        }
        if (options.transform !== undefined) this.transform = options.transform;
    }

    get source(): ShapeNode | undefined {
        // Resolved once: the source object survives a group transfer even though the id
        // lookup would no longer find it in the document tree. A disposed source is not
        // a valid target any more — drop it and resolve again.
        if (this._source !== undefined && !this._source.isDisposed) return this._source;
        this._source = undefined;

        // `findNodeDeep` reaches nodes moved into a Component definition.
        const found = this.document.modelManager.findNodeDeep((x) => x.id === this.sourceId);
        // A self-reference would read this node's shape forever; a disposed node is no
        // longer a valid target. Both are treated as dangling.
        const source = found === this || (found instanceof ShapeNode && found.isDisposed) ? undefined : found;
        // Compare against the SUBSCRIBED node: after a disposed source was cleared,
        // `_source` is already undefined and would skip unsubscribing it.
        const next = source instanceof ShapeNode ? source : undefined;
        if (next !== this._watched) this.watch(next);
        return this._source;
    }

    override get shape(): Result<IShape> {
        // A disposed `ShapeNode` can hold `null` rather than a `Result`; never leak that
        // through this getter — callers read `.isOk` unconditionally.
        const shape = this.source?.shape;
        return shape instanceof Result ? shape : Result.err("Instance source not found");
    }

    /** The source owns its shape; an instance never replaces it. */
    override set shape(_value: Result<IShape>) {}

    protected override createMesh(): IShapeMeshData {
        const source = this.source;
        if (source === undefined) return { edges: undefined, faces: undefined, vertexs: undefined };
        const mesh = source.mesh;

        // The source's `mesh.faces` is already merged and reordered by ITS paint. Merging
        // that again would read the instance's pairs against reordered range indexes, so
        // start from the raw faces (`_originFaceMesh`) instead.
        const rawFaces = source.unmergedFaceMesh ?? mesh.faces;
        this._originFaceMesh = rawFaces;

        // Always hand back a copy: `GeometryNode.updateVisual` writes `_mesh.faces` when
        // the instance is painted, and that must not reach the source's shared mesh.
        // `Object.create` keeps prototype getters (the mesh builds its vertex data
        // lazily); `faces` is then shadowed by a writable own property.
        const copy = Object.create(
            Object.getPrototypeOf(mesh),
            Object.getOwnPropertyDescriptors(mesh),
        ) as IShapeMeshData;
        // Always derive the grouping from the raw faces, never from the source's merged
        // ones: those carry the SOURCE's material indexes, while the instance's
        // `materialId` is a creation-time snapshot. Reusing them would leave a group
        // pointing past the instance's palette after the source gained a material.
        // An empty pair list merges to the raw faces themselves (one group at index 0).
        const faces =
            rawFaces === undefined
                ? mesh.faces
                : MeshUtils.mergeFaceMesh(
                      rawFaces,
                      this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex]),
                  );
        Object.defineProperty(copy, "faces", {
            value: faces,
            writable: true,
            configurable: true,
            enumerable: true,
        });
        return copy;
    }

    override disposeInternal(): void {
        this._watched?.removePropertyChanged(this.onSourceShapeChanged);
        this._watched = undefined;
        this._source = undefined;
        super.disposeInternal();
    }

    private watch(source: ShapeNode | undefined): void {
        const hadSource = this._watched !== undefined;
        this._watched?.removePropertyChanged(this.onSourceShapeChanged);
        this._watched = source;
        this._source = source;
        source?.onPropertyChanged(this.onSourceShapeChanged);
        if (hadSource !== (source !== undefined)) {
            this.emitPropertyChanged("warningCount", hadSource ? 0 : 1);
        }
    }

    /** A source rebuild invalidates the shared mesh; the renderer listens for `shape`. */
    private readonly onSourceShapeChanged = (property: keyof ShapeNode) => {
        if (property !== "shape") return;
        this._mesh = undefined;
        this.emitPropertyChanged("shape", this._shape);
    };

    /** A retarget (including undo/redo) drops the cached source and refreshes the mesh. */
    private readonly handleSourceIdChanged = (property: PropertyKey) => {
        if (property !== "sourceId") return;
        this.watch(undefined);
        this._mesh = undefined;
        this.emitPropertyChanged("shape", this._shape);
    };
}
