// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { Id } from "../foundation";
import { BoundingBox } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { IShapeMeshData } from "../shape";
import { VisualNode } from "./visualNode";

export abstract class GeometryNode extends VisualNode {
    @Serializer.serialze()
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string) {
        this.setProperty("materialId", value);
    }

    constructor(document: IDocument, name: string, materialId?: string, id: string = Id.generate()) {
        super(document, name, id);
        this.setPrivateValue("materialId", materialId ?? document.materials.at(0)?.id ?? "");
    }

    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        this._mesh ??= this.createMesh();
        return this._mesh as any;
    }

    protected _boundingBox: BoundingBox | undefined;
    override boundingBox(): BoundingBox | undefined {
        if (this._boundingBox === undefined) {
            let points = this.mesh.faces?.position;
            if (!points || points.length === 0) {
                points = this.mesh.edges?.position;
            }

            if (!points || points.length === 0) {
                return undefined;
            }
            this._boundingBox = BoundingBox.fromNumbers(this.transform.ofPoints(points));
        }
        return this._boundingBox;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._mesh = undefined;
    }

    protected abstract createMesh(): IShapeMeshData;
}
