// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandConstructor } from "../command";
import type { AppGuideSection } from "../guide";
import type { Locale } from "../i18n";
import type { IService } from "../service";
import type { RibbonTabProfile } from "../ui/ribbon";

export type Plugin = {
    /** Commands to register*/
    commands?: CommandConstructor[];

    /** Ribbon contributions to register*/
    ribbons?: RibbonTabProfile[];

    /** Sections to append to the app manual the AI assistant reads (see AppGuideStore). Plain
     *  text, registered as-is when the plugin loads — not re-translated on a later language change. */
    guide?: AppGuideSection[];

    /** I18n resources to register*/
    i18nResources?: Locale[];

    /** Services to register */
    services?: IService[];
};
