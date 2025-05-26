// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { IDocument } from "../document";
import { Id } from "../foundation";
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
    /**
     * if the materialId is a string, it means that all faces use the same material.
     * if the materialId is an array, it means that each face has a different material.
     */
    @Serializer.serialze()
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string | string[] {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string | string[]) {
        this.setProperty("materialId", value);
    }

    protected _originFaceMesh?: FaceMeshData;
    /**
     * @internal internal use only, do not use it directly.
     * [[faceIndex, materialIndex], [faceIndex, materialIndex], ...]
     * materialIndex is the index of the material in the material list.
     */
    @Serializer.serialze()
    get faceMaterialPair(): FaceMaterialPair[] {
        return this.getPrivateValue("faceMaterialPair", []);
    }
    set faceMaterialPair(value: FaceMaterialPair[]) {
        this.setProperty("faceMaterialPair", value, () => this.updateVisual());
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

    addFaceMaterial(pairs: { faceIndex: number; materialId: string }[]) {
        pairs.forEach(({ faceIndex, materialId }) => {
            if (this.materialId === materialId) {
                return;
            }

            if (this._mesh?.faces?.range.length === 1) {
                this.materialId = materialId;
                return;
            }

            if (typeof this.materialId === "string") {
                this.materialId = [this.materialId, materialId];
            }

            const index = this.materialId.indexOf(materialId);
            if (index === -1) {
                this.materialId.push(materialId);
                this.faceMaterialPair.push(new FaceMaterialPair(faceIndex, this.materialId.length - 1));
            } else {
                this.faceMaterialPair.push(new FaceMaterialPair(faceIndex, index));
            }
        });
        this.updateVisual();
    }

    removeFaceMaterial(faceIndexs: number[]) {
        faceIndexs.forEach((faceIndex) => {
            const pair = this.faceMaterialPair.find((x) => x.faceIndex === faceIndex);
            if (!pair) {
                return;
            }
            this.faceMaterialPair.splice(this.faceMaterialPair.indexOf(pair), 1);
            const hasSameMaterial = this.faceMaterialPair.some(
                (x) => x.materialIndex === pair.materialIndex,
            );
            if (!hasSameMaterial && Array.isArray(this.materialId)) {
                this.materialId.splice(pair.materialIndex, 1);
                if (this.materialId.length === 1) {
                    this.materialId = this.materialId[0];
                }
            }
        });

        this.updateVisual();
    }

    clearFaceMaterial() {
        this.materialId = Array.isArray(this.materialId) ? this.materialId[0] : this.materialId;
        this.faceMaterialPair = [];
        this.updateVisual();
    }

    private readonly updateVisual = () => {
        if (!this._originFaceMesh) return;

        if (this.faceMaterialPair.length === 0) {
            this._mesh!.faces = this._originFaceMesh;
        } else {
            this._mesh!.faces = MeshUtils.mergeFaceMesh(
                this._originFaceMesh,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex] as [number, number]),
            );
            if (this._mesh!.faces.groups.length === 1) {
                this.materialId = this.materialId[this.faceMaterialPair[0].materialIndex];
            }
        }

        this.document.visual.context.redrawNode([this]);
    };

    protected abstract createMesh(): IShapeMeshData;
}
