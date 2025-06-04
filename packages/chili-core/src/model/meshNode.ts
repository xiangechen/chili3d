// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { Id } from "../foundation";
import { I18nKeys } from "../i18n";
import { BoundingBox } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { Mesh } from "../shape";
import { VisualNode } from "./visualNode";

@Serializer.register(["document", "mesh", "name", "id"])
export class MeshNode extends VisualNode {
    override display(): I18nKeys {
        return "body.meshNode";
    }

    @Serializer.serialze()
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string | string[] {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string | string[]) {
        this.setProperty("materialId", value);
    }

    protected _mesh: Mesh;
    @Serializer.serialze()
    get mesh(): Mesh {
        return this._mesh;
    }
    set mesh(value: Mesh) {
        this.setProperty("mesh", value);
    }

    constructor(
        document: IDocument,
        mesh: Mesh,
        name: string,
        materialId?: string | string[],
        id: string = Id.generate(),
    ) {
        super(document, name, id);
        this._mesh = mesh;
        this.setPrivateValue("materialId", materialId ?? document.materials.at(0)?.id ?? "");
    }

    override boundingBox(): BoundingBox | undefined {
        let points = this.transform.ofPoints(this.mesh.position!);
        return BoundingBox.fromNumbers(points);
    }
}
