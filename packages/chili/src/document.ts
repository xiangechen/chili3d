// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Act,
    Constants,
    History,
    I18n,
    type IApplication,
    type IDocument,
    Id,
    type ISelection,
    type IVisual,
    Logger,
    ModelManager,
    Observable,
    ObservableCollection,
    PubSub,
    type Serialized,
    Serializer,
} from "chili-core";
import { Selection } from "./selection";

export class Document extends Observable implements IDocument {
    readonly visual: IVisual;
    readonly history: History;
    readonly selection: ISelection;
    readonly acts = new ObservableCollection<Act>();
    readonly modelManager: ModelManager;

    static readonly version = __DOCUMENT_VERSION__;

    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(name: string) {
        if (this.name === name) return;
        this.setProperty("name", name);
        if (this.modelManager.rootNode) this.modelManager.rootNode.name = name;
    }

    constructor(
        readonly application: IApplication,
        name: string,
        readonly id: string = Id.generate(),
    ) {
        super();
        this.setPrivateValue("name", name);
        this.modelManager = new ModelManager(this);
        this.history = new History();
        this.visual = application.visualFactory.create(this);
        this.selection = new Selection(this);
        application.documents.add(this);

        Logger.info(`new document: ${name}`);
    }

    serialize(): Serialized {
        const serialized = {
            classKey: "Document",
            version: __DOCUMENT_VERSION__,
            properties: {
                id: this.id,
                name: this.name,
                models: this.modelManager.serialize(),
                acts: this.acts.map((x) => Serializer.serializeObject(x)),
            },
        };
        return serialized;
    }

    override disposeInternal(): void {
        super.disposeInternal();

        this.modelManager.dispose();
        this.visual.dispose();
        this.history.dispose();
        this.selection.dispose();
        this.acts.forEach((x) => x.dispose());
        this.acts.clear();
    }

    async save() {
        const data = this.serialize();
        await this.application.storage.put(Constants.DBName, Constants.DocumentTable, this.id, data);
        const image = this.application.activeView?.toImage();
        await this.application.storage.put(Constants.DBName, Constants.RecentTable, this.id, {
            id: this.id,
            name: this.name,
            date: Date.now(),
            image,
        });
    }

    async close() {
        if (window.confirm(I18n.translate("prompt.saveDocument{0}", this.name))) {
            await this.save();
        }

        const views = this.application.views.filter((x) => x.document === this);
        this.application.views.remove(...views);
        this.application.activeView = this.application.views.at(0);
        this.application.documents.delete(this);

        PubSub.default.pub("documentClosed", this);

        Logger.info(`document: ${this.name} closed`);
        this.dispose();
    }

    static async open(application: IApplication, id: string) {
        const data = (await application.storage.get(
            Constants.DBName,
            Constants.DocumentTable,
            id,
        )) as Serialized;
        if (data === undefined) {
            Logger.warn(`document: ${id} not find`);
            return;
        }
        const document = await Document.load(application, data);
        if (document !== undefined) {
            Logger.info(`document: ${document.name} opened`);
        }
        return document;
    }

    static async load(app: IApplication, data: Serialized): Promise<IDocument | undefined> {
        if ((data as any).version !== __DOCUMENT_VERSION__) {
            alert(
                "The file version has been upgraded, no compatibility treatment was done in the development phase",
            );
            return undefined;
        }
        const document = new Document(app, data.properties["name"], data.properties["id"]);
        document.history.disabled = true;
        document.acts.push(
            ...data.properties["acts"].map((x: Serialized) => Serializer.deserializeObject(document, x)),
        );

        await document.modelManager.deserialize(data.properties["models"]);
        document.history.disabled = false;
        return document;
    }
}
