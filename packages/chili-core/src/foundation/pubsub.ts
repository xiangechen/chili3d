// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CommandKeys, ICommand } from "../command";
import { IDocument } from "../document";
import { I18nKeys } from "../i18n";
import { Material } from "../material";
import { INode } from "../model";
import { ObjectSnapType } from "../snapType";
import { CursorType, IView } from "../visual";
import { AsyncController } from "./asyncController";
import { IDisposable } from "./disposable";
import { MessageType } from "./messageType";
import { IPropertyChanged } from "./observer";
import { Result } from "./result";

export interface PubSubEventMap {
    executeCommand: (commandName: CommandKeys) => void;
    activeViewChanged: (view: IView | undefined) => void;
    viewClosed: (view: IView) => void;
    modelUpdate: (model: INode) => void;
    visibleChanged: (model: INode) => void;
    parentVisibleChanged: (model: INode) => void;
    selectionChanged: (document: IDocument, selected: INode[], unselected: INode[]) => void;
    snapTypeChanged: (snapeType: ObjectSnapType) => void;
    statusBarTip: (tip: I18nKeys) => void;
    clearStatusBarTip: () => void;
    showFloatTip: (level: MessageType, msg: string) => void;
    clearFloatTip: () => void;
    showInput: (text: string, handler: (text: string) => Result<string, I18nKeys>) => void;
    clearInput: () => void;
    showSelectionControl: (controller: AsyncController) => void;
    clearSelectionControl: () => void;
    openCommandContext: (command: ICommand) => void;
    closeCommandContext: () => void;
    displayHome: (show: boolean) => void;
    showProperties(document: IDocument, nodes: INode[]): void;
    showToast: (message: I18nKeys, ...args: any[]) => void;
    displayError: (message: string) => void;
    showPermanent: (action: () => Promise<void>, message: I18nKeys, ...args: any[]) => void;
    showDialog: (title: I18nKeys, context: IPropertyChanged, callback: () => void) => void;
    viewCursor: (cursor: CursorType) => void;
    editMaterial: (document: IDocument, material: Material, callback: (material: Material) => void) => void;
}

export class PubSub implements IDisposable {
    static readonly default: PubSub = new PubSub();

    private readonly _events: Map<any, Set<(...args: any[]) => void>>;

    constructor() {
        this._events = new Map();
    }

    dispose() {
        this._events.forEach((v, k) => {
            v.clear();
        });
        this._events.clear();
    }

    sub<T extends PubSubEventMap, K extends keyof T>(
        event: K,
        callback: T[K] extends (...args: any[]) => any ? T[K] : never,
    ) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set<(...args: any[]) => void>());
        }
        this._events.get(event)!.add(callback);
    }

    pub<T extends PubSubEventMap, K extends keyof T>(
        event: K,
        ...args: Parameters<T[K] extends (...args: any[]) => any ? T[K] : never>
    ) {
        this._events.get(event)?.forEach((x) => {
            x(...args);
        });
    }

    remove<T extends PubSubEventMap, K extends keyof T>(
        event: K,
        callback: T[K] extends (...args: any[]) => any ? T[K] : never,
    ) {
        let callbacks = this._events.get(event);
        if (callbacks?.has(callback)) {
            callbacks.delete(callback);
        }
    }

    removeAll<K extends keyof PubSubEventMap>(event: K) {
        this._events.get(event)?.clear();
    }
}
