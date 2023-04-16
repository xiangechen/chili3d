// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants, IDocument, Lazy, Logger, PubSub } from "chili-core";
import { Tree } from "chili-ui";

import { Application } from "../application";
import { IApplicationService } from "./applicationService";

export class TreeService implements IApplicationService {
    private static _instance = new Lazy(() => new TreeService());
    static get instance() {
        return this._instance.value;
    }

    private documentTreeMap = new WeakMap<IDocument, Tree>();
    private app: Application | undefined;
    readonly root: HTMLElement;
    private constructor() {
        let root = document.getElementById(Constants.TreeContainerId);
        if (root === null) throw `not find ${Constants.TreeContainerId}`;
        this.root = root;
    }

    register(app: Application): void {
        this.app = app;
        Logger.info(`${TreeService.name} registed`);
    }

    start(): void {
        PubSub.default.sub("activeDocumentChanged", this.handleDocumentChanged);
        Logger.info(`${TreeService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("activeDocumentChanged", this.handleDocumentChanged);
        Logger.info(`${TreeService.name} stoped`);
    }

    private current: IDocument | undefined;

    private handleDocumentChanged = (document: IDocument | undefined) => {
        if (this.current !== undefined && this.documentTreeMap.has(this.current)) {
            this.root.removeChild(this.documentTreeMap.get(this.current)!);
        }
        this.current = document;
        if (document === undefined) return;

        let tree = this.documentTreeMap.get(document);
        if (tree === undefined) {
            tree = new Tree(document);
            this.documentTreeMap.set(document, tree);
        }
        this.root.append(tree);
    };
}
