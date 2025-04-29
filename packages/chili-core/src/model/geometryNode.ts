// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { IDocument } from "../document";
import { Id } from "../foundation";
import { BoundingBox } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { IShapeMeshData } from "../shape";
import { VisualNode } from "./visualNode";

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

    /**
     * @internal internal use only, do not use it directly.
     * [[faceIndex, materialIndex], [faceIndex, materialIndex], ...]
     * materialIndex is the index of the material in the material list.
     */
    @Serializer.serialze()
    get faceMaterialPair(): [number, number][] {
        return this.getPrivateValue("faceMaterialPair", []);
    }
    set faceMaterialPair(value: [number, number][]) {
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

    setFaceMaterial(faceIndex: number, materialId: string) {
        if (this.materialId === materialId) {
            return;
        }

        if (typeof this.materialId === "string") {
            this.materialId = [this.materialId, materialId];
            this.faceMaterialPair.push([faceIndex, 1]);
        } else {
            const index = this.materialId.indexOf(materialId);
            if (index === -1) {
                this.materialId.push(materialId);
                this.faceMaterialPair.push([faceIndex, this.materialId.length - 1]);
            } else {
                this.faceMaterialPair.push([faceIndex, index]);
            }
        }

        this.updateVisual();
    }

    private updateVisual() {
        if (!this._mesh?.faces) return;

        this._mesh.faces = MeshUtils.mergeFaceMesh(this._mesh.faces, this.faceMaterialPair);
        this.document.visual.context.redrawNode([this]);
    }

    protected abstract createMesh(): IShapeMeshData;
}
