// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id, PropertyHistoryRecord, Transaction } from "../foundation";
import { I18n } from "../i18n";
import { BoundingBox } from "../math";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import type { FaceMeshData, IShapeMeshData } from "../shape";
import { MeshUtils } from "../shape/meshUtils";
import { NodeUtils } from "./node";
import { VisualNode } from "./visualNode";

export interface FaceMaterialPairOptions {
    faceIndex: number;
    materialIndex: number;
}

@serializable()
export class FaceMaterialPair {
    @serialize()
    faceIndex: number;

    @serialize()
    materialIndex: number;
    constructor(options: FaceMaterialPairOptions) {
        this.faceIndex = options.faceIndex;
        this.materialIndex = options.materialIndex;
    }
}

export interface GeometryNodeOptions {
    document: IDocument;
    name?: string;
    materialId?: string | string[];
    id?: string;
}

const NoneName = "$$_NONE_$$";

export abstract class GeometryNode extends VisualNode {
    @serialize()
    @property("common.material", { type: "materialId" })
    get materialId(): string | string[] {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string | string[]) {
        this.setProperty("materialId", value);
    }

    protected _originFaceMesh?: FaceMeshData;

    /**
     * The face mesh before per-face material grouping, captured once per shape — the holders
     * of a new shape (`ShapeNode.setShape`, an instance's source change) clear it. `createMesh`
     * writes the merged result back into the mesher's cache and later builds may re-read that,
     * so the merge must always start from here, never from `mesh.faces`; a consumer that must
     * merge again (a `BodyInstanceNode` copying the source's paint) does the same. Range
     * indexes here are the original face indexes.
     */
    get unmergedFaceMesh(): FaceMeshData | undefined {
        return this._originFaceMesh;
    }

    @serialize()
    get faceMaterialPair(): FaceMaterialPair[] {
        return this.getPrivateValue("faceMaterialPair", []);
    }
    set faceMaterialPair(value: FaceMaterialPair[]) {
        const oldMaterisl = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        const Face = [...this.faceMaterialPair];
        this.setProperty("faceMaterialPair", value, () => this.updateVisual(oldMaterisl, Face));
    }

    constructor(options: GeometryNodeOptions) {
        super(options.document, options.name ?? NoneName, options.id ?? Id.generate());
        this.setPrivateValue(
            "materialId",
            options.materialId ?? options.document.modelManager.materials.at(0)?.id ?? "",
        );
        if (this.name === NoneName) {
            this.setPrivateValue(
                "name",
                NodeUtils.generateName(options.document, I18n.translate(this.display())),
            );
        }
    }

    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        this._mesh ??= this.createMesh();
        return this._mesh as any;
    }

    /**
     * Drop every cached mesh — the visual mesh and the raw faces captured for the face-material
     * merge. Only a shape change (or disposal) may call this: `_originFaceMesh` belongs to the
     * outgoing shape, and the incoming shape's mesher will hand createMesh its own raw faces.
     * A same-shape display refresh must use `refreshMesh` — clearing the raw faces there would
     * re-capture them from the mesher cache, which by then holds the MERGED faces.
     */
    protected invalidateMesh(): void {
        this._mesh = undefined;
        this._originFaceMesh = undefined;
    }

    /**
     * Drop the cached mesh and rebuild the visual. Called by the node itself when geometry
     * inputs change, and by features whose own state feeds `createMesh` (e.g. the extra
     * display edges of `ShapeNode`). Nodes not in the scene (mid-construction, removed but
     * kept by the history) have no visual to rebuild.
     *
     * `_originFaceMesh` deliberately survives: the shape is unchanged, so its raw faces are
     * still the ones the next `createMesh` must merge from.
     */
    refreshMesh(): void {
        this._mesh = undefined;
        if (!this._isDisposed && this.document.visual.context.getVisual(this) !== undefined) {
            this.document.visual.context.redrawNode([this]);
        }
    }

    override boundingBox(): BoundingBox | undefined {
        let points = this.mesh.faces?.position;
        if (!points || points.length === 0) {
            points = this.mesh.edges?.position;
        }

        if (!points || points.length === 0) {
            return undefined;
        }
        return BoundingBox.fromNumbers(this.transform.ofPoints(points));
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this.invalidateMesh();
    }

    private copyOldValue() {
        const oldMaterial = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        const oldFacePair = [...this.faceMaterialPair];
        return {
            oldFacePair,
            oldMaterial,
        };
    }

    addFaceMaterial(pairs: { faceIndex: number; materialId: string }[]) {
        const { oldFacePair, oldMaterial } = this.copyOldValue();
        pairs.forEach(({ faceIndex, materialId }) => {
            if (this.materialId === materialId) {
                return;
            }

            if (this._mesh?.faces?.range.length === 1) {
                this.setPrivateValue("materialId", materialId);
                return;
            }

            if (typeof this.materialId === "string") {
                this.setPrivateValue("materialId", [this.materialId, materialId]);
            }

            const index = this.materialId.indexOf(materialId);
            if (index === -1) {
                (this.materialId as string[]).push(materialId);
                this.faceMaterialPair.push(
                    new FaceMaterialPair({ faceIndex, materialIndex: this.materialId.length - 1 }),
                );
            } else {
                this.faceMaterialPair.push(new FaceMaterialPair({ faceIndex, materialIndex: index }));
            }
        });
        this.updateVisual(oldMaterial, oldFacePair);
    }

    removeFaceMaterial(faceIndexs: number[]) {
        const { oldFacePair, oldMaterial } = this.copyOldValue();
        const toDelete = this.faceMaterialPair.filter((x) => faceIndexs.includes(x.faceIndex));
        this.setPrivateValue(
            "faceMaterialPair",
            this.faceMaterialPair.filter((x) => !faceIndexs.includes(x.faceIndex)),
        );
        toDelete.forEach((pair) => {
            const hasSameMaterial = this.faceMaterialPair.some((x) => x.materialIndex === pair.materialIndex);
            if (hasSameMaterial || !Array.isArray(this.materialId)) {
                return;
            }
            this.materialId.splice(pair.materialIndex, 1);
            if (this.materialId.length === 1) {
                this.setPrivateValue("materialId", this.materialId[0]);
            } else if (this.materialId.length > 1) {
                this.faceMaterialPair.forEach((x) => {
                    if (x.materialIndex > pair.materialIndex) {
                        x.materialIndex--;
                    }
                });
            }
        });

        this.updateVisual(oldMaterial, oldFacePair);
    }

    clearFaceMaterial() {
        const { oldFacePair, oldMaterial } = this.copyOldValue();

        if (Array.isArray(this.materialId)) {
            this.setPrivateValue("materialId", this.materialId[0]);
        }
        this.setPrivateValue("faceMaterialPair", []);

        this.updateVisual(oldMaterial, oldFacePair);
    }

    private readonly updateVisual = (oldMaterisl: string | string[], oldFacePair: FaceMaterialPair[]) => {
        if (!this._originFaceMesh) return;
        if (this.faceMaterialPair.length === 0) {
            this._mesh!.faces = this._originFaceMesh;
        } else {
            this._mesh!.faces = MeshUtils.mergeFaceMesh(
                this._originFaceMesh,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex] as [number, number]),
            );
            if (this._mesh!.faces.groups.length === 1) {
                this.setPrivateValue("materialId", this.materialId[this.faceMaterialPair[0].materialIndex]);
            }
        }

        this.emitPropertyChanged("materialId", oldMaterisl);
        this.emitPropertyChanged("faceMaterialPair", oldFacePair);
        const newMaterisl = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        Transaction.add(
            this.document,
            new PropertyHistoryRecord(this, "materialId", oldMaterisl, newMaterisl),
        );
        Transaction.add(
            this.document,
            new PropertyHistoryRecord(this, "faceMaterialPair", oldFacePair, [...this.faceMaterialPair]),
        );

        this.document.visual.context.redrawNode([this]);
    };

    protected abstract createMesh(): IShapeMeshData;
}
