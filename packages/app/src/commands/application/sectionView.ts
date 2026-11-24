// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    AsyncController,
    command,
    FolderNode,
    type IApplication,
    type IDocument,
    type IEventHandler,
    type IStep,
    type IView,
    LENGTH_UNITS,
    MultistepCommand,
    NodeUtils,
    type ParameterValue,
    Plane,
    PropertyHistoryRecord,
    PubSub,
    property,
    SectionPlaneNode,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import { SectionOffsetDragHandler } from "./sectionOffsetDrag";
import { SectionPlanePickStep } from "./sectionPlanePick";

const sessions = new WeakMap<IView, SectionViewCommand>();

PubSub.default.sub("nodeDoubleClicked", (node) => {
    if (!(node instanceof SectionPlaneNode)) return;
    const view = node.document.application.activeView;
    if (!view || view.document !== node.document || sessions.has(view)) return;
    PubSub.default.pub("executeCommand", "act.sectionView", node);
});

function rotate(vector: XYZ, axis: XYZ, degrees: number): XYZ {
    return vector.rotate(axis, (degrees * Math.PI) / 180) ?? vector;
}

export function ensureViewFolder(document: IDocument): FolderNode {
    const existing = document.modelManager.findNode(
        (node) => node instanceof FolderNode && node.name === "Views",
    );
    if (existing instanceof FolderNode) return existing;
    const folder = new FolderNode({ document, name: "Views" });
    document.modelManager.addNode(folder);
    return folder;
}

@command({
    key: "act.sectionView",
    icon: "icon-sectionView",
    toggleOnExecute: true,
})
export class SectionViewCommand extends MultistepCommand {
    constructor(private readonly editRequest?: SectionPlaneNode) {
        super();
    }

    @property("sectionView.offset", { unit: LENGTH_UNITS })
    get offset(): ParameterValue {
        return this.getPrivateValue("offset", 0);
    }
    set offset(value: ParameterValue) {
        this.setProperty("offset", value, this.applyPlane);
    }

    @property("sectionView.angleX", { unit: ANGLE_UNITS })
    get angleX(): ParameterValue {
        return this.getPrivateValue("angleX", 0);
    }
    set angleX(value: ParameterValue) {
        this.setProperty("angleX", value, this.applyPlane);
    }

    @property("sectionView.angleY", { unit: ANGLE_UNITS })
    get angleY(): ParameterValue {
        return this.getPrivateValue("angleY", 0);
    }
    set angleY(value: ParameterValue) {
        this.setProperty("angleY", value, this.applyPlane);
    }

    @property("sectionView.flip")
    get flipped(): boolean {
        return this.getPrivateValue("flipped", false);
    }
    set flipped(value: boolean) {
        this.setProperty("flipped", value, this.applyPlane);
    }

    private view?: IView;
    private referencePlane?: Plane;
    private sectionNode?: SectionPlaneNode;
    private editNode?: SectionPlaneNode;
    private offsetDrag?: SectionOffsetDragHandler;
    private previousEventHandler?: IEventHandler;
    private unwatchLifecycle?: () => void;
    private closedWithView = false;
    private dragDocument?: IDocument;
    private dragStartPlane?: Plane;
    private dragHistoryDisabled = false;

    override async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (!view) return;
        const existing = sessions.get(view);
        if (existing) {
            await existing.cancel();
            return;
        }

        this.editNode = this.editRequest?.document === view.document ? this.editRequest : undefined;
        sessions.set(view, this);
        try {
            await super.execute(application);
        } finally {
            if (sessions.get(view) === this) sessions.delete(view);
        }
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        this.closedWithView = false;
        this.resetStepDatas();
        const view = this.application.activeView;
        if (!view) {
            this.closeQuietly();
            return;
        }
        this.view = view;
        this.sectionNode = undefined;
        this.referencePlane = this.editNode?.plane;
        this.setProperty("offset", 0);
        this.setProperty("angleX", 0);
        this.setProperty("angleY", 0);
        this.setProperty("flipped", false);
        this.sectionNode = this.editNode;
        this.unwatchLifecycle = this.watchLifecycle(this.view);
    }

    protected override afterExecute(): void {
        this.stopOffsetDrag();
        this.unwatchLifecycle?.();
        this.unwatchLifecycle = undefined;
        super.afterExecute();
    }

    protected override getSteps(): IStep[] {
        return this.editNode ? [] : [new SectionPlanePickStep()];
    }

    protected override async executeMainTask(): Promise<void> {
        const picked = this.stepDatas[0];
        if (picked?.plane) this.setReferencePlane(picked.plane, picked.point);
        const referencePlane = this.referencePlane;
        if (!this.view || !referencePlane || this.isCanceled || this.closedWithView) return;
        const controller = new AsyncController();
        this.controller = controller;
        try {
            this.startOffsetDrag(this.view, referencePlane, referencePlane.origin, controller);
            await new Promise<void>((resolve) => {
                controller.onCancelled(() => resolve());
                controller.onCompleted(() => resolve());
                controller.onFailed(() => resolve());
            });
        } finally {
            this.stopOffsetDrag();
        }
    }

    private startOffsetDrag(
        view: IView,
        referencePlane: Plane,
        anchor: Plane["origin"],
        controller: AsyncController,
    ): void {
        const visual = view.document.visual;
        const handler = new SectionOffsetDragHandler(view.document, controller, {
            anchor,
            normal: referencePlane.normal,
            xvec: referencePlane.xvec,
            yvec: referencePlane.yvec,
            direction: () => this.sectionNode?.plane.normal ?? referencePlane.normal,
            flipped: () => this.flipped,
            offset: () => this.offsetValue() ?? 0,
            setOffset: (value) => (this.offset = value),
            angle: (axis) => this.angleValue(axis) ?? 0,
            setAngle: (axis, value) => {
                if (axis === "x") this.angleX = value;
                else this.angleY = value;
            },
            onDragStart: this.beginDrag,
            onDragEnd: this.endDrag,
        });
        this.offsetDrag = handler;
        this.previousEventHandler = visual.eventHandler;
        visual.eventHandler = handler;
        handler.start(view);
    }

    private readonly beginDrag = (): void => {
        const node = this.sectionNode;
        if (!node || this.dragDocument) return;
        this.dragDocument = node.document;
        this.dragStartPlane = node.plane;
        this.dragHistoryDisabled = node.document.history.disabled;
        node.document.history.disabled = true;
    };

    private readonly endDrag = (): void => {
        const document = this.dragDocument;
        if (!document) return;
        const oldPlane = this.dragStartPlane;
        this.dragDocument = undefined;
        this.dragStartPlane = undefined;
        document.history.disabled = this.dragHistoryDisabled;
        const node = this.sectionNode;
        if (node && oldPlane && oldPlane !== node.plane) {
            Transaction.add(document, new PropertyHistoryRecord(node, "plane", oldPlane, node.plane));
        }
    };

    private stopOffsetDrag(): void {
        const handler = this.offsetDrag;
        if (!handler) return;
        const visual = handler.document.visual;
        if (visual.eventHandler === handler) {
            visual.eventHandler = this.previousEventHandler ?? visual.defaultEventHandler;
        }
        this.offsetDrag = undefined;
        this.previousEventHandler = undefined;
        handler.dispose();
    }

    private watchLifecycle(view: IView): () => void {
        const onViewClosed = (closedView: IView) => {
            if (closedView === view) this.closeQuietly();
        };
        const onDocumentClosed = (document: IDocument) => {
            if (document === view.document) this.closeQuietly();
        };
        PubSub.default.sub("viewClosed", onViewClosed);
        PubSub.default.sub("documentClosed", onDocumentClosed);
        return () => {
            PubSub.default.remove("viewClosed", onViewClosed);
            PubSub.default.remove("documentClosed", onDocumentClosed);
        };
    }

    private closeQuietly(): void {
        if (this.closedWithView) return;
        this.closedWithView = true;
        this.controller?.cancel();
    }

    private setReferencePlane(plane: Plane, anchor: Plane["origin"] = plane.origin): void {
        this.referencePlane = plane.translateTo(plane.project(anchor));
        this.setProperty("offset", 0);
        this.setProperty("angleX", 0);
        this.setProperty("angleY", 0);
        this.setProperty("flipped", false);
        const document = this.view?.document;
        const sectionPlane = this.computePlane();
        if (!document || !sectionPlane) return;
        const node = new SectionPlaneNode({
            document,
            plane: sectionPlane,
            name: NodeUtils.generateName(document, "Section"),
        });
        Transaction.execute(document, "section view", () => ensureViewFolder(document).add(node));
        this.sectionNode = node;
    }

    private offsetValue(): number | undefined {
        const offset = this.resolveParameter(this.offset, LENGTH_UNITS);
        return offset.isOk && Number.isFinite(offset.value) ? offset.value : undefined;
    }

    private angleValue(axis: "x" | "y"): number | undefined {
        const angle = this.resolveParameter(axis === "x" ? this.angleX : this.angleY, ANGLE_UNITS);
        return angle.isOk && Number.isFinite(angle.value) ? angle.value : undefined;
    }

    private computePlane(): Plane | undefined {
        if (!this.referencePlane) return undefined;
        const offset = this.offsetValue();
        const angleX = this.angleValue("x");
        const angleY = this.angleValue("y");
        if (offset === undefined || angleX === undefined || angleY === undefined) return undefined;
        const reference = this.referencePlane;
        const rotatedNormal = rotate(
            rotate(reference.normal, reference.xvec, angleX),
            reference.yvec,
            angleY,
        );
        const rotatedX = rotate(rotate(reference.xvec, reference.xvec, angleX), reference.yvec, angleY);
        const normal = this.flipped ? rotatedNormal.reverse() : rotatedNormal;
        const origin = reference.origin.add(reference.normal.multiply(offset));
        return new Plane({ origin, normal, xvec: rotatedX });
    }

    private readonly applyPlane = (): void => {
        const plane = this.computePlane();
        if (this.sectionNode && plane) this.sectionNode.plane = plane;
        if (this.view) this.offsetDrag?.refreshArrow(this.view);
    };
}
