// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DefaultFont, FontCatalog } from "@chili3d/core";
import { capabilitiesSource } from "../tools/capabilities.generated";
import type { Skill } from "./types";

/**
 * The one creation op that is not an `IShapeFactory` method — see `runTextOp` in the
 * capability engine. It is written out here rather than generated, because the catalogue is
 * generated from the factory's own methods and a line of text is built from a font instead.
 */
const textOp = `## text — a creation op, and not an IShapeFactory method

{"method":"text","args":{"text":"Hello","size":10,"depth":2,"font":"Noto Sans SC","plane":{"origin":{"x":0,"y":0,"z":0},"normal":{"x":0,"y":0,"z":1}}}}

- "text"  (required) the line to draw — a line, not a paragraph: a newline in it is drawn as a glyph
- "size"  the height of one em, in mm (default 10)
- "depth" how far the line is extruded, in mm (default 2)
- "font"  a family from the catalogue (default "${DefaultFont.family}")
- "plane" the plane the line stands in, in the same encoding a modeling method takes one for
          (default the XY plane): the line is set on that plane and extruded along its normal

A font file is fetched by URL the first time a family is named in a session, so every family
has a size: ${catalogue()}. Glyphs a font does not have are logged and left out of the line.
The line starts at the plane's origin and runs along the plane's x axis.
`;

/** The catalogue, as families with what each costs to fetch. */
function catalogue(): string {
    return FontCatalog.map((font) => `${font.family} (${(font.size / 1024 / 1024).toFixed(1)} MB)`).join(
        ", ",
    );
}

/**
 * The creation-op counterpart of shape-query, and by far the most-loaded skill — the
 * catalog is ~5k characters, which is a third of the resident prompt, so it lives here
 * and is pulled on demand instead.
 */
export const modelingApi: Skill = {
    name: "modeling-api",
    description:
        "The IShapeFactory catalog behind run_program creation ops: every method's signature, parameter kinds and return type — load it before composing run_program ops",
    content: `${capabilitiesSource}\n\n${textOp}`,
};
