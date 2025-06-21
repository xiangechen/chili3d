// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DOCUMENT_FILE_EXTENSION,
    I18n,
    IApplication,
    ICommand,
    IDataExchange,
    IDocument,
    IService,
    IShapeFactory,
    IStorage,
    IView,
    IVisualFactory,
    IWindow,
    Material,
    ObservableCollection,
    Plane,
    PubSub,
    Serialized,
} from "chili-core";
import { Document } from "./document";
import { importFiles } from "./utils";

let app: Application | undefined;

export interface ApplicationOptions {
    visualFactory: IVisualFactory;
    shapeFactory: IShapeFactory;
    services: IService[];
    storage: IStorage;
    dataExchange: IDataExchange;
    mainWindow?: IWindow;
}

export class Application implements IApplication {
    readonly dataExchange: IDataExchange;
    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;
    readonly services: IService[];
    readonly storage: IStorage;
    readonly mainWindow?: IWindow;

    readonly views = new ObservableCollection<IView>();
    readonly documents: Set<IDocument> = new Set<IDocument>();

    executingCommand: ICommand | undefined;

    private _activeView: IView | undefined;
    get activeView(): IView | undefined {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        if (this._activeView === value) return;
        this._activeView = value;
        PubSub.default.pub("activeViewChanged", value);
    }

    constructor(option: ApplicationOptions) {
        if (app !== undefined) {
            throw new Error("Only one application can be created");
        }
        app = this;
        this.visualFactory = option.visualFactory;
        this.shapeFactory = option.shapeFactory;
        this.services = option.services;
        this.storage = option.storage;
        this.dataExchange = option.dataExchange;
        this.mainWindow = option.mainWindow;

        this.services.forEach((x) => x.register(this));
        this.services.forEach((x) => x.start());

        this.initWindowEvents();
    }

    private initWindowEvents() {
        window.onbeforeunload = this.handleWindowUnload;
        window.addEventListener(
            "dragstart",
            (ev) => {
                ev.preventDefault();
            },
            false,
        );
        window.addEventListener(
            "dragover",
            (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                ev.dataTransfer!.dropEffect = "copy";
            },
            false,
        );
        window.addEventListener(
            "drop",
            (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                this.importFiles(ev.dataTransfer?.files);
            },
            false,
        );
    }

    private readonly handleWindowUnload = (event: BeforeUnloadEvent) => {
        if (this.activeView) {
            // Cancel the event as stated by the standard.
            event.preventDefault();
            // Chrome requires returnValue to be set.
            event.returnValue = "";
        }
    };

    async importFiles(files: FileList | undefined) {
        if (!files || files.length === 0) {
            return;
        }
        const { opens, imports } = this.groupFiles(files);
        this.loadDocumentsWithLoading(opens);
        importFiles(this, imports);
    }

    private loadDocumentsWithLoading(opens: File[]) {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                for (const file of opens) {
                    let json: Serialized = JSON.parse(await file.text());
                    await this.loadDocument(json);
                    this.activeView?.cameraController.fitContent();
                }
            },
            "toast.excuting{0}",
            I18n.translate("command.doc.open"),
        );
    }

    private groupFiles(files: FileList) {
        const opens: File[] = [];
        const imports: File[] = [];
        for (const element of files) {
            if (element.name.endsWith(DOCUMENT_FILE_EXTENSION)) {
                opens.push(element);
            } else {
                imports.push(element);
            }
        }
        return { opens, imports };
    }

    async openDocument(id: string): Promise<IDocument | undefined> {
        const document = await Document.open(this, id);
        await this.createActiveView(document);
        return document;
    }

    async newDocument(name: string): Promise<IDocument> {
        const document = new Document(this, name);
        const lightGray = new Material(document, "LightGray", 0xdedede);
        const deepGray = new Material(document, "DeepGray", 0x898989);
        document.materials.push(lightGray, deepGray);
        await this.createActiveView(document);
        return document;
    }

    async loadDocument(data: Serialized): Promise<IDocument | undefined> {
        const document = await Document.load(this, data);
        await this.createActiveView(document);
        return document;
    }

    protected async createActiveView(document: IDocument | undefined) {
        if (document === undefined) return undefined;
        const view = document.visual.createView("3d", Plane.XY);
        this.activeView = view;
    }
}
