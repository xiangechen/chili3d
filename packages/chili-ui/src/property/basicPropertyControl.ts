// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IConverter, type IDocument, Logger, type Property } from "chili-core";
import { CheckProperty } from "./check";
import { ColorProperty } from "./colorProperty";
import { InputProperty } from "./input";
import { MaterialProperty } from "./materialProperty";

export function basicPropertyControl(
    document: IDocument,
    objs: any[],
    prop: Property,
    converter?: IConverter,
) {
    if (prop === undefined || objs.length === 0) return "";

    if (prop.type === "color") {
        return new ColorProperty(document, objs, prop);
    }

    if (prop.type === "materialId" && canShowMaterialProperty(objs, prop)) {
        return new MaterialProperty(document, objs, prop);
    }

    const value = objs[0][prop.name];
    if (["object", "string", "number"].includes(typeof value)) {
        return new InputProperty(document, objs, prop, converter);
    }

    if (typeof value === "boolean") {
        return new CheckProperty(document, objs, prop);
    }

    Logger.warn(`Property ${prop.name} not found in ${Object.getPrototypeOf(objs[0]).constructor.name}`);
    return "";
}

function canShowMaterialProperty(objs: any[], prop: Property) {
    if (objs.length === 0) return false;
    if (objs.length === 1) return true;
    return objs.every((obj) => obj[prop.name] === objs[0][prop.name]);
}
