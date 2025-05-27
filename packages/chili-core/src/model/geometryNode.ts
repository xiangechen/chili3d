// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { IDocument } from "../document";
import { Id, PropertyHistoryRecord, Transaction } from "../foundation";
import { BoundingBox } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { FaceMeshData, IShapeMeshData } from "../shape";
import { VisualNode } from "./visualNode";

@Serializer.register(["faceIndex", "materialIndex"])
export class FaceMaterialPair {
    @Serializer.serialze()
    faceIndex: number;

    @Serializer.serialze()
    materialIndex: number;
    constructor(faceIndex: number, materialIndex: number) {
        this.faceIndex = faceIndex;
        this.materialIndex = materialIndex;
    }
}

export abstract class GeometryNode extends VisualNode {
    @Serializer.serialze()
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string | string[] {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string | string[]) {
        this.setProperty("materialId", value);
    }

    protected _originFaceMesh?: FaceMeshData;

    @Serializer.serialze()
    get faceMaterialPair(): FaceMaterialPair[] {
        return this.getPrivateValue("faceMaterialPair", []);
    }
    set faceMaterialPair(value: FaceMaterialPair[]) {
        const oldMaterisl = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        const Face = [...this.faceMaterialPair];
        this.setProperty("faceMaterialPair", value, () => this.updateVisual(oldMaterisl, Face));
    }

    constructor(
        document: IDocument,
        name: string,
        materialId?: string | string[],
        id: string = Id.generate(),
    ) {
        super(document, name, id);
        this.setPrivateValue("materialId", materialId ?? document.materials.at(0)?.id ?? "");
    }

    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        this._mesh ??= this.createMesh();
        return this._mesh as any;
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
        this._mesh = undefined;
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
                this.faceMaterialPair.push(new FaceMaterialPair(faceIndex, this.materialId.length - 1));
            } else {
                this.faceMaterialPair.push(new FaceMaterialPair(faceIndex, index));
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
            const hasSameMaterial = this.faceMaterialPair.some(
                (x) => x.materialIndex === pair.materialIndex,
            );
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
