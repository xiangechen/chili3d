// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id } from "../foundation";
import type { I18nKeys } from "../i18n";
import { BoundingBox } from "../math";
import { property } from "../property";
import { serializable, serialze } from "../serialize";
import type { Mesh } from "../shape";
import { VisualNode } from "./visualNode";

@serializable(["document", "mesh", "name", "id"])
export class MeshNode extends VisualNode {
    override display(): I18nKeys {
        return "body.meshNode";
    }

    @serialze()
    @property("common.material", { type: "materialId" })
    get materialId(): string | string[] {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string | string[]) {
        this.setProperty("materialId", value);
    }

    protected _mesh: Mesh;
    @serialze()
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
        this.setPrivateValue("materialId", materialId ?? document.modelManager.materials.at(0)?.id ?? "");
    }

    override boundingBox(): BoundingBox | undefined {
        const points = this.transform.ofPoints(this.mesh.position!);
        return BoundingBox.fromNumbers(points);
    }
}
