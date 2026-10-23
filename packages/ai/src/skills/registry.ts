// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { appGuide } from "./appGuide";
import { curveQuery } from "./curveQuery";
import { errorRecovery } from "./errorRecovery";
import { modelingApi } from "./modelingApi";
import { modelingRecipes } from "./modelingRecipes";
import { parametricModeling } from "./parametricModeling";
import { shapeQuery } from "./shapeQuery";
import { surfaceQuery } from "./surfaceQuery";
import type { Skill } from "./types";

export type { Skill };

/**
 * Every skill the assistant can load, in the order they are advertised. This is only the
 * register — each skill's text lives in its own module beside this one, so adding one is a
 * new file plus a line here, not another hundred lines of prose in this one. The list built
 * here is the built-in set only; a module or build that adds a skill of its own registers it
 * with SkillStore (see skillStore.ts) rather than editing this array.
 */
export const SKILLS: Skill[] = [
    appGuide,
    modelingApi,
    shapeQuery,
    curveQuery,
    surfaceQuery,
    modelingRecipes,
    errorRecovery,
    parametricModeling,
];
