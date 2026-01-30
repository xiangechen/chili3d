// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IConverter, type IDocument, type Property, Texture } from "chili-core";
import { basicPropertyControl } from "./basicPropertyControl";
import { TextureProperty } from "./textureProperty";

export function propertyControl(document: IDocument, objs: any[], prop: Property, converter?: IConverter) {
    if (prop === undefined || objs.length === 0) return "";

    const value = objs[0][prop.name];
    if (value instanceof Texture) {
        return new TextureProperty(document, prop.display, value);
    }

    return basicPropertyControl(document, objs, prop, converter);
}
