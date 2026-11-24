// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id } from "../foundation";
import type { I18nKeys } from "../i18n";
import type { BoundingBox, Plane } from "../math";
import { serializable, serialize } from "../serialize";
import { VisualNode } from "./visualNode";

export interface SectionPlaneNodeOptions {
    document: IDocument;
    plane: Plane;
    name?: string;
    id?: string;
}

@serializable()
export class SectionPlaneNode extends VisualNode {
    readonly isReferenceGeometry = true;

    @serialize()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }
    set plane(value: Plane) {
        this.setProperty("plane", value);
    }

    constructor(options: SectionPlaneNodeOptions) {
        super(options.document, options.name ?? "Section", options.id ?? Id.generate());
        this.setPrivateValue("plane", options.plane);
    }

    get icon(): string {
        return "icon-sectionView";
    }

    override get transformMode(): "none" {
        return "none";
    }

    display(): I18nKeys {
        return "command.act.sectionView";
    }

    boundingBox(): BoundingBox | undefined {
        return undefined;
    }
}

export function sectionPlaneNodes(document: IDocument): SectionPlaneNode[] {
    return document.modelManager.findNodes(
        (node): node is SectionPlaneNode => node instanceof SectionPlaneNode,
    ) as SectionPlaneNode[];
}
