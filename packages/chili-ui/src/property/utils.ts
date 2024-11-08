// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, IDocument, Property, VisualNode } from "chili-core";
import { CheckProperty } from "./check";
import { ColorProperty } from "./colorProperty";
import { InputProperty } from "./input";
import { MaterialProperty } from "./materialProperty";

export function appendProperty(container: HTMLElement, document: IDocument, objs: any[], prop?: Property) {
    if (prop === undefined || objs.length === 0) return;
    if (!(prop.name in objs[0])) {
        alert(`Property ${prop.name} not found in ${Object.getPrototypeOf(objs[0]).constructor.name}`);
        return;
    }

    const propValue = (objs[0] as unknown as any)[prop.name];
    const type = typeof propValue;

    if (prop.type === "color") {
        container.append(new ColorProperty(document, objs, prop));
    } else if (prop.type === "materialId") {
        container.append(
            new MaterialProperty(
                document,
                objs.filter((x) => "materialId" in x),
                prop,
            ),
        );
    } else if (type === "object" || type === "string" || type === "number") {
        container.append(new InputProperty(document, objs, prop));
    } else if (type === "boolean") {
        container.append(new CheckProperty(objs, prop));
    }
}
