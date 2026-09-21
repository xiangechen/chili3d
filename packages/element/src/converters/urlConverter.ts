// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IConverter, Result } from "@chili3d/core";

export class UrlStringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        // The value sits inside a quoted CSS string, so a quote in the value has to be escaped —
        // an SVG data URL is written with single quotes throughout, and an unescaped one ends the
        // string at its first attribute, which the browser then drops as invalid. A texture like
        // that still shows on the model: it is loaded as an `<img src>`, where the quotes are part
        // of an attribute and need no escaping.
        const escaped = value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
        return Result.ok(`url('${escaped}')`);
    }
}
