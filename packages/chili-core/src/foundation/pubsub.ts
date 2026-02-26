// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, ICommand } from "../command";
import type { IDocument } from "../document";
import type { I18nKeys } from "../i18n";
import type { Material } from "../material";
import type { INode } from "../model";
import type { DialogResult } from "../ui";
import type { CursorType, IView } from "../visual";
import type { AsyncController } from "./asyncController";
import type { IDisposable } from "./disposable";
import type { MessageType } from "./messageType";
import type { Result } from "./result";

export interface PubSubEventMap {
    activeViewChanged: (view: IView | undefined) => void;
    clearFloatTip: () => void;
    clearInput: () => void;
    clearSelectionControl: () => void;
    clearStatusBarTip: () => void;
    closeCommandContext: () => void;
    displayError: (message: string) => void;
    displayHome: (show: boolean) => void;
    documentClosed: (document: IDocument) => void;
    editMaterial: (document: IDocument, material: Material, callback: (material: Material) => void) => void;
    executeCommand: (commandName: CommandKeys) => void;
    modelUpdate: (model: INode) => void;
    openCommandContext: (command: ICommand) => void;
    parentVisibleChanged: (model: INode) => void;
    selectionChanged: (document: IDocument, selected: INode[], unselected: INode[]) => void;
    showDialog: (title: I18nKeys, content: HTMLElement, callback?: (result: DialogResult) => void) => void;
    showFloatTip: (dom: HTMLElement | { level: MessageType; msg: string }) => void;
    showInput: (text: string, handler: (text: string) => Result<string, I18nKeys>) => void;
    showPermanent: (action: () => Promise<void>, message: I18nKeys, ...args: any[]) => void;
    showProperties(document: IDocument, nodes: INode[]): void;
    showSelectionControl: (controller: AsyncController) => void;
    showToast: (message: I18nKeys, ...args: any[]) => void;
    statusBarTip: (tip: I18nKeys) => void;
    viewClosed: (view: IView) => void;
    viewCursor: (cursor: CursorType) => void;
    visibleChanged: (model: INode) => void;
}

type EventCallback = (...args: any[]) => void;
type EventMap = Map<keyof PubSubEventMap, Set<EventCallback>>;

export class PubSub implements IDisposable {
    static readonly default = new PubSub();
    private readonly events: EventMap = new Map();
    private isDisposed = false;

    dispose(): void {
        this.isDisposed = true;
        this.events.forEach((callbacks) => callbacks.clear());
        this.events.clear();
    }

    sub<K extends keyof PubSubEventMap>(event: K, callback: PubSubEventMap[K]): void {
        if (this.isDisposed) {
            return;
        }

        const callbacks = this.events.get(event) ?? new Set<EventCallback>();
        callbacks.add(callback);
        this.events.set(event, callbacks);
    }

    pub<K extends keyof PubSubEventMap>(event: K, ...args: Parameters<PubSubEventMap[K]>): void {
        if (this.isDisposed) {
            return;
        }

        this.events.get(event)?.forEach((callback) => callback(...args));
    }

    remove<K extends keyof PubSubEventMap>(event: K, callback: PubSubEventMap[K]): void {
        if (this.isDisposed) {
            return;
        }

        this.events.get(event)?.delete(callback);
    }

    removeAll<K extends keyof PubSubEventMap>(event: K): void {
        if (this.isDisposed) {
            return;
        }

        this.events.get(event)?.clear();
    }
}
