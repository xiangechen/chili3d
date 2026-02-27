// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { RibbonTabProfile } from "chili-api";
import type { CommandConstructor } from "../command";
import type { Locale } from "../i18n";
import type { IService } from "../service";

export type Plugin = {
    /** Commands to register*/
    commands?: CommandConstructor[];

    /** Ribbon contributions to register*/
    ribbons?: RibbonTabProfile[];

    /** I18n resources to register*/
    i18nResources?: Locale[];

    /** Services to register */
    services?: IService[];
};
