// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModel, IModelObject } from "chili-geo";
import { I18n, IDisposable, MessageLevel, ObjectSnapType, Valid } from "chili-shared";
import { IDocument } from "./interfaces";

export interface PubSubEventMap {
    keyDown: (e: KeyboardEvent) => void;
    keyUp: (e: KeyboardEvent) => void;
    excuteCommand: (commandName: string) => void;
    modelAdded: (source: IDocument, model: IModelObject) => void;
    activeDocumentChanged: (document: IDocument | undefined) => void;
    modelRemoved: (source: IDocument, model: IModelObject) => void;
    parentChanged: (source: IModelObject, oldParent: string | undefined, newParent: string | undefined) => void;
    selectionChanged: (document: IDocument, models: IModelObject[]) => void;
    snapChanged: (snapeType: ObjectSnapType) => void;
    statusBarTip: (tip: string) => void;
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

    sub<T extends PubSubEventMap, K extends keyof T>(event: K, callback: T[K]): void;
    sub(event: any, callback: (...args: any[]) => void) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set<(...args: any[]) => void>());
        }
        this._events.get(event)!.add(callback as unknown as any);
    }

    pub<T extends PubSubEventMap, K extends keyof T>(event: K): T[K];
    pub(event: any): (...args: any[]) => void {
        return (...args: any[]): void => {
            this._events.get(event)?.forEach((x) => {
                x(...args);
            });
        };
    }

    remove<T extends PubSubEventMap, K extends keyof T>(event: K, callback: T[K]): void;
    remove(event: any, callback: any) {
        let callbacks = this._events.get(event);
        if (callbacks?.has(callback)) {
            callbacks.delete(callback);
        }
    }

    removeAll<K extends keyof PubSubEventMap>(event: K): void;
    removeAll(event: string | symbol): void {
        this._events.get(event)?.clear();
    }
}
