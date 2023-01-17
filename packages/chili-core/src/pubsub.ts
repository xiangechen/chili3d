// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModel, IModelGroup, IModelObject } from "chili-geo";
import { Commands, I18n, IDisposable, MessageLevel, ObjectSnapType, Valid } from "chili-shared";
import { IDocument } from "./interfaces";

export interface PubSubEventMap {
    keyDown: (e: KeyboardEvent) => void;
    keyUp: (e: KeyboardEvent) => void;
    excuteCommand: (commandName: keyof Commands) => void;
    modelAdded: (source: IDocument, model: IModelObject) => void;
    activeDocumentChanged: (document: IDocument | undefined) => void;
    modelRemoved: (source: IDocument, model: IModelObject) => void;
    modelUpdate: (model: IModelObject) => void;
    visibleChanged: (model: IModelObject) => void;
    parentChanged: (
        source: IModelObject,
        oldParent: IModelGroup | undefined,
        newParent: IModelGroup | undefined
    ) => void;
    selectionChanged: (document: IDocument, models: IModelObject[]) => void;
    snapChanged: (snapeType: ObjectSnapType) => void;
    statusBarTip: (tip: keyof I18n) => void;
    clearStatusBarTip: () => void;
    floatTip: (level: MessageLevel, msg: string) => void;
    clearFloatTip: () => void;
    showInput: (validCallback: (text: string) => Valid, callback: (text: string) => void) => void;
    clearInput: () => void;
}

export class PubSub implements IDisposable {
    static readonly default: PubSub = new PubSub();

    private _events: Map<any, Set<(...args: any[]) => void>>;

    constructor() {
        this._events = new Map();
    }

    dispose(): void {
        this._events.forEach((v, k) => {
            v.clear();
        });
        this._events.clear();
    }

    sub<T extends PubSubEventMap, K extends keyof T>(
        event: K,
        callback: T[K] extends (...args: any[]) => any ? T[K] : never
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
        callback: T[K] extends (...args: any[]) => any ? T[K] : never
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
