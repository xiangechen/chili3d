// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    PubSub,
    ModelObject,
    Logger,
    IView,
    Validation,
    XYZ,
    I18n,
    IEventHandler,
    IDisposable,
    VertexRenderData,
    Model,
    CursorType,
    IShape,
} from "chili-core";
import { Application } from "../application";
import { LineBody } from "../bodys";
import { Dimension, PointSnapper, ShapePreviewer, SnapEventHandler } from "../snap";
import { IApplicationService } from "./applicationService";

export class EditorService implements IApplicationService {
    private static _instance: EditorService | undefined;

    public static get instance() {
        if (EditorService._instance === undefined) {
            EditorService._instance = new EditorService();
        }
        return EditorService._instance;
    }

    private handler?: EditorEventHandler;

    register(_app: Application): void {
        Logger.info(`${EditorService.name} registed`);
    }

    start(): void {
        PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
        Logger.info(`${EditorService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("selectionChanged", this.handleSelectionChanged);
        Logger.info(`${EditorService.name} stoped`);
    }

    private handleSelectionChanged = (document: IDocument, models: ModelObject[]) => {
        if (this.handler !== undefined) {
            this.handler.dispose();
            this.handler = undefined;
        }
        if (models.length > 0) {
            this.handler = this.getEventHandler(document, models);
            if (this.handler !== undefined) {
                this.handler.showEditorPoints();
                document.visualization.eventHandler = this.handler;
            }
        } else {
            document.visualization.clearEventHandler();
        }
        document.viewer.redraw();
    };

    private getEventHandler(document: IDocument, models: ModelObject[]): EditorEventHandler | undefined {
        if (models.length > 1) return undefined;
        if (ModelObject.isModel(models[0])) {
            let body = models[0].body;
            if (body instanceof LineBody) {
                return new LineEditorEventHandler(document, body);
            }
        }
        return undefined;
    }
}

export interface FeaturePoint {
    point: XYZ;
    preview: ShapePreviewer;
    tip: keyof I18n;
    setter: (newPoint: XYZ) => void;
}

export abstract class EditorEventHandler implements IEventHandler, IDisposable {
    private snapedIndex?: number;
    protected points: FeaturePoint[] = [];
    protected shapes: number[] = [];

    constructor(readonly document: IDocument) {}

    showEditorPoints() {
        for (const x of this.featurePoints()) {
            this.points.push(x);
            this.shapes.push(this.showPoint(x.point));
        }
    }

    abstract featurePoints(): FeaturePoint[];

    private showPoint(point: XYZ): number {
        let start = VertexRenderData.from(point, 0xffff00, 5);
        return this.document.visualization.context.temporaryDisplay(start);
    }

    dispose(): void | Promise<void> {
        this.shapes.forEach((x) => {
            this.document.visualization.context.temporaryRemove(x);
        });
        this.shapes.length = 0;
        this.points.length = 0;
    }
    pointerMove(view: IView, event: PointerEvent): void {
        for (let i = 0; i < this.points.length; i++) {
            const point = this.points[i];
            if (this.distanceToMouse(view, event.offsetX, event.offsetY, point.point) < 4) {
                view.document.viewer.setCursor(CursorType.Drawing);
                this.snapedIndex = i;
                return;
            }
        }
        this.snapedIndex = undefined;
        view.document.viewer.setCursor(CursorType.Default);
    }
    pointerDown(view: IView, event: PointerEvent): void {}
    async pointerUp(view: IView, event: PointerEvent) {
        if (this.snapedIndex === undefined) return;
        let snapper = new PointSnapper({
            dimension: Dimension.D1D2D3,
            refPoint: this.points[this.snapedIndex].point,
            preview: this.points[this.snapedIndex].preview,
        });
        let data = await snapper.snap(this.document, this.points[this.snapedIndex].tip);
        if (data?.point === undefined) return;
        this.points[this.snapedIndex].setter(data.point);
        this.document.visualization.context.temporaryRemove(this.shapes[this.snapedIndex]);
        this.shapes[this.snapedIndex] = this.showPoint(data.point);
        view.document.viewer.redraw();
        this.snapedIndex = undefined;
    }

    private distanceToMouse(view: IView, x: number, y: number, point: XYZ) {
        let xy = view.worldToScreen(point);
        let dx = xy.x - x;
        let dy = xy.y - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    mouseWheel(view: IView, event: WheelEvent): void {}
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            view.document.visualization.selection.clearSelected();
        }
    }
    keyUp(view: IView, event: KeyboardEvent): void {}
}

export class LineEditorEventHandler extends EditorEventHandler {
    constructor(document: IDocument, readonly line: LineBody) {
        super(document);
    }

    featurePoints(): FeaturePoint[] {
        return [
            {
                point: this.line.start,
                tip: "line.start",
                preview: (x) => this.linePreview(x, this.line.end),
                setter: (p) => (this.line.start = p),
            },
            {
                point: this.line.end,
                tip: "line.end",
                preview: (x) => this.linePreview(this.line.start, x),
                setter: (p) => (this.line.end = p),
            },
        ];
    }

    private linePreview = (s: XYZ, e: XYZ): IShape => {
        return Application.instance.shapeFactory.line(s, e).value!;
    };
}
