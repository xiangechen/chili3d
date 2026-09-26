// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DIMENSION_TEXT_HEIGHT,
    type DimensionAnnotation,
    type DimensionAnnotationOptions,
    FolderNode,
    type IDocument,
    type INode,
    LENGTH_UNITS,
    MultistepCommand,
    property,
    Transaction,
} from "@chili3d/core";

interface DimensionPreview {
    readonly transaction: Transaction;
    readonly annotation: DimensionAnnotation;
}

/**
 * The plumbing every dimension command shares: the live preview is the real
 * annotation node, created when the position pick begins, so what the cursor
 * draws — text, arrows, gaps — is what committing keeps; its transaction
 * commits on success and rolls back on cancel. The subclass answers where the
 * points go.
 */
export abstract class DimensionCommandBase extends MultistepCommand {
    private preview?: DimensionPreview;
    private redrawPreview?: () => void;

    @property("dimension.textHeight", { unit: LENGTH_UNITS })
    get textHeight(): number {
        return this.getPrivateValue("textHeight", DIMENSION_TEXT_HEIGHT);
    }
    set textHeight(value: number) {
        if (value > 0) {
            this.setProperty("textHeight", value);
            this.redrawPreview?.();
        }
    }

    /** The preview annotation, for the mouse-move callbacks to retarget. */
    protected get previewAnnotation(): DimensionAnnotation | undefined {
        return this.preview?.annotation;
    }

    /** Subclass: create the preview annotation with its current points. */
    protected abstract createPreviewAnnotation(): DimensionAnnotation;

    /** Subclass: set the final picked points on the annotation. */
    protected abstract commitAnnotation(annotation: DimensionAnnotation): void;

    /** PointSnapData.beforeExecute: the position pick begins — bring the preview up. */
    protected readonly startPreview = (): void => {
        const transaction = new Transaction(this.document, "create DimensionAnnotation");
        transaction.start();
        const annotation = this.createPreviewAnnotation();
        ensureAnnotationFolder(this.document).add(annotation);
        this.preview = { transaction, annotation };
    };

    /** PointSnapData.onPreviewReady: keep the redraw callback for the textHeight input. */
    protected readonly onPreviewReady = (redraw: () => void): void => {
        this.redrawPreview = redraw;
    };

    protected override executeMainTask(): void {
        if (!this.preview) this.startPreview();
        const { transaction, annotation } = this.preview!;
        this.preview = undefined;

        Transaction.execute(this.document, "create DimensionAnnotation", () => {
            this.commitAnnotation(annotation);
            this.document.visual.update();
        });
        transaction.commit();
        this.repeatOperation = true;
    }

    protected override afterExecute(): void {
        // A cancel never reaches executeMainTask: drop the preview annotation here.
        if (this.preview) {
            this.preview.transaction.rollback();
            this.preview = undefined;
        }
        super.afterExecute();
    }
}

/** All annotations live under one "Annotations" folder at the document root. */
export function ensureAnnotationFolder(document: IDocument): FolderNode {
    let node: INode | undefined = document.modelManager.rootNode.firstChild;
    while (node) {
        if (node instanceof FolderNode && node.name === "Annotations") {
            return node;
        }
        node = node.nextSibling;
    }

    const folder = new FolderNode({ document, name: "Annotations" });
    document.modelManager.addNode(folder);
    return folder;
}
