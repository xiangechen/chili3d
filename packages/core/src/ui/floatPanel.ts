// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { I18nKeys } from "../i18n/keys";

export interface FloatPanelOptions {
    title: I18nKeys;
    content: HTMLElement;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    x?: number;
    y?: number;
    actions?: HTMLElement[];
    /**
     * The document whose state the panel shows, when it shows one — the panel closes with it.
     * A panel that reads and writes a document cannot outlive it: closing disposes what it
     * was about to write into.
     */
    document?: IDocument;
    onClose?: () => void;
}
