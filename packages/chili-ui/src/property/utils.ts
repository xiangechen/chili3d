// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Property } from "chili-core";
import { InputProperty } from "./input";
import { CheckProperty } from "./check";
import { ColorProperty } from "./colorProperty";

export function appendProperty(container: HTMLElement, document: IDocument, objs: any[], prop?: Property) {
    if (prop === undefined) return;
    const propValue = (objs[0] as unknown as any)[prop.name];
    const type = typeof propValue;

    if (prop.type === "color") {
        container.append(new ColorProperty(document, objs, prop));
    } else if (type === "object" || type === "string" || type === "number") {
        container.append(new InputProperty(document, objs, prop));
    } else if (type === "boolean") {
        container.append(new CheckProperty(objs, prop));
    }
}
