// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";

export type DialogButton = {
    content: I18nKeys;
    shouldClose?: () => boolean;
    onclick?: () => void | Promise<void>;
};
