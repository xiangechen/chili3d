// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys } from "@chili3d/core";
import { ConstraintKind, isStructuralConstraint, type SketchConstraintData } from "../sketchModel";
import { formatDatum } from "./dimensionLayout";
import { applyConstraintIcon, badgeIcon, badgeSymbol } from "./sketchAnnotations";
import style from "./sketchConstraintsPanel.module.css";
import type { SketchEditor } from "./sketchEditor";

/** Row label of a constraint kind — reuses the names of the commands that create it. */
const CONSTRAINT_LABELS: Record<ConstraintKind, I18nKeys> = {
    [ConstraintKind.P2PCoincident]: "command.constraint.coincident",
    [ConstraintKind.P2PDistance]: "command.dimension.distance",
    [ConstraintKind.Equal]: "command.constraint.equal",
    [ConstraintKind.PointOnLine]: "command.constraint.pointOn",
    [ConstraintKind.Horizontal]: "command.constraint.horizontal",
    [ConstraintKind.Vertical]: "command.constraint.vertical",
    [ConstraintKind.Parallel]: "command.constraint.parallel",
    [ConstraintKind.Perpendicular]: "command.constraint.perpendicular",
    [ConstraintKind.P2LDistance]: "command.dimension.pointLineDistance",
    [ConstraintKind.Angle]: "command.dimension.angle",
    [ConstraintKind.Radius]: "command.dimension.radius",
    [ConstraintKind.EqualLength]: "command.constraint.equal",
    [ConstraintKind.EqualRadius]: "command.constraint.equal",
    [ConstraintKind.PointOnCircle]: "command.constraint.pointOn",
    [ConstraintKind.Midpoint]: "command.constraint.midpoint",
    [ConstraintKind.Symmetric]: "command.constraint.symmetric",
    [ConstraintKind.TangentLineCircle]: "command.constraint.tangent",
    [ConstraintKind.TangentCircleCircle]: "command.constraint.tangent",
    [ConstraintKind.HorizontalDistance]: "command.dimension.horizontalDistance",
    [ConstraintKind.VerticalDistance]: "command.dimension.verticalDistance",
    [ConstraintKind.HorizontalAlign]: "command.constraint.horizontalAlign",
    [ConstraintKind.VerticalAlign]: "command.constraint.verticalAlign",
    [ConstraintKind.Fix]: "command.constraint.fix",
    [ConstraintKind.PointOnArc]: "command.constraint.pointOn",
    [ConstraintKind.EqualArcRadius]: "command.constraint.equal",
    [ConstraintKind.TangentLineArc]: "command.constraint.tangent",
    [ConstraintKind.TangentArcArc]: "command.constraint.tangent",
    [ConstraintKind.TangentCircleArc]: "command.constraint.tangent",
};

function datumText(constraint: SketchConstraintData): string | undefined {
    if (constraint.datums !== undefined) {
        return constraint.datums.map((datum) => formatDatum(constraint.kind, datum)).join(", ");
    }
    if (constraint.datum !== undefined) return formatDatum(constraint.kind, constraint.datum);
    return undefined;
}

/**
 * The FreeCAD-style constraint list, hosted in a float panel by the `SketchEditor`:
 * a header on top (a state dot for the solve — red on conflict, amber on redundant,
 * green when fully constrained — plus the constraint count; the degree-of-freedom
 * number lives in the status bar), and every user constraint below. Flagged
 * constraints carry the issue on their own row: a red or amber chip next to the
 * name, on top of the row tint.
 *
 * Row interactions mirror the viewport badges: click selects (shift adds), hovering
 * highlights the constraint's badge along with its referenced entities,
 * double-clicking a datum row re-opens its value input, and the trailing button
 * deletes the constraint.
 * Selection stays in sync both ways through `annotations.onSelectionChanged`.
 *
 * All DOM is raw `document.createElement` — the parametric package depends only
 * on core, so the element helpers the ui package uses are unavailable here
 * (`datumPrompt.ts` is the package's precedent).
 */
export class SketchConstraintsPanel {
    readonly element: HTMLElement;
    private readonly headerSection: HTMLElement;
    private readonly headerCount: HTMLElement;
    private readonly listSection: HTMLElement;
    private readonly rows = new Map<number, HTMLElement>();
    private disposed = false;

    constructor(private readonly editor: SketchEditor) {
        this.element = document.createElement("div");
        this.element.className = style.root;
        this.headerSection = document.createElement("div");
        this.headerSection.className = style.header;
        const dot = document.createElement("span");
        dot.className = style.dot;
        const headerLabel = document.createElement("span");
        headerLabel.className = style.headerLabel;
        I18n.set(headerLabel, "textContent", "sketch.constraints");
        this.headerCount = document.createElement("span");
        this.headerCount.className = style.count;
        this.headerSection.append(dot, headerLabel, this.headerCount);
        this.listSection = document.createElement("div");
        this.listSection.className = style.list;
        this.element.append(this.headerSection, this.listSection);
        editor.annotations.onSelectionChanged = this.syncSelection;
    }

    refresh(): void {
        if (this.disposed) return;
        this.refreshList();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.editor.annotations.onSelectionChanged === this.syncSelection) {
            this.editor.annotations.onSelectionChanged = undefined;
        }
        this.element.remove();
    }

    private readonly syncSelection = (ids: number[]): void => {
        const selected = new Set(ids);
        for (const [id, row] of this.rows) {
            row.classList.toggle(style.selected, selected.has(id));
        }
    };

    /** Header count plus the state dot: red on conflict, amber on redundant, green when fully constrained. */
    private refreshHeader(count: number): void {
        this.headerCount.textContent = String(count);
        const { dofs, conflicting, redundant } = this.editor.diagnostics;
        const state =
            conflicting.length > 0
                ? style.conflicting
                : redundant.length > 0
                  ? style.redundant
                  : dofs === 0
                    ? style.ok
                    : undefined;
        this.headerSection.classList.remove(style.conflicting, style.redundant, style.ok);
        if (state !== undefined) this.headerSection.classList.add(state);
    }

    private refreshList(): void {
        this.rows.clear();
        this.listSection.replaceChildren();
        const constraints = this.editor.solver.toData().constraints.filter((c) => !isStructuralConstraint(c));
        this.refreshHeader(constraints.length);
        if (constraints.length === 0) {
            const empty = document.createElement("div");
            empty.className = style.empty;
            I18n.set(empty, "textContent", "sketch.noConstraints");
            this.listSection.append(empty);
            return;
        }
        const selected = new Set(this.editor.annotations.selectedConstraintIds);
        for (const constraint of constraints) {
            const row = this.buildRow(constraint);
            row.classList.toggle(style.selected, selected.has(constraint.id));
            this.rows.set(constraint.id, row);
            this.listSection.append(row);
        }
    }

    /**
     * The issue rides on the row itself: a red "conflict" or amber "redundant" chip
     * next to the name, plus the row tint — FreeCAD's list marks them the same way.
     */
    private addIssueChip(row: HTMLElement, id: number): void {
        const { conflicting, redundant } = this.editor.diagnostics;
        const isConflicting = conflicting.includes(id);
        if (!isConflicting && !redundant.includes(id)) return;
        const issueClass = isConflicting ? style.conflicting : style.redundant;
        row.classList.add(issueClass);
        const chip = document.createElement("span");
        chip.className = `${style.chip} ${issueClass}`;
        I18n.set(chip, "textContent", isConflicting ? "sketch.issue.conflicting" : "sketch.issue.redundant");
        row.append(chip);
        // a broken datum keeps its own, more specific tooltip (the resolve error)
        if (row.title === "") {
            row.title = I18n.translate(isConflicting ? "sketch.conflicting" : "sketch.redundant");
        }
    }

    private buildRow(constraint: SketchConstraintData): HTMLElement {
        const row = document.createElement("div");
        row.className = style.row;
        row.append(this.buildIcon(constraint), this.buildName(constraint));

        // set the broken datum's tooltip first so addIssueChip's guard can yield to it
        const error = this.editor.solver.datumErrors.get(constraint.id);
        if (error !== undefined) {
            row.classList.add(style.broken);
            row.title = error;
        }
        this.addIssueChip(row, constraint.id);

        const datum = datumText(constraint);
        if (datum !== undefined) {
            const value = document.createElement("span");
            value.className = style.value;
            value.textContent = datum;
            row.append(value);
        }
        row.append(this.buildDeleteButton(constraint.id));

        row.addEventListener("click", (e) => this.selectRow(constraint.id, e.shiftKey));
        row.addEventListener("mouseenter", () => this.editor.highlightConstraint(constraint.id));
        row.addEventListener("mouseleave", () => this.editor.highlightConstraint(undefined));
        if (constraint.datum !== undefined || constraint.datums !== undefined) {
            row.addEventListener("dblclick", () => this.editor.editDatum(constraint.id));
        }
        return row;
    }

    private buildIcon(constraint: SketchConstraintData): HTMLElement {
        const icon = document.createElement("span");
        icon.className = style.icon;
        const symbol = badgeSymbol(constraint.kind);
        if (symbol !== undefined) applyConstraintIcon(icon, symbol);
        return icon;
    }

    private buildName(constraint: SketchConstraintData): HTMLElement {
        const name = document.createElement("span");
        name.className = style.name;
        name.textContent = `#${constraint.id} ${I18n.translate(CONSTRAINT_LABELS[constraint.kind])}`;
        return name;
    }

    private buildDeleteButton(constraintId: number): HTMLElement {
        const button = document.createElement("button");
        button.className = style.delete;
        button.append(badgeIcon("icon-times"));
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            this.editor.deleteConstraints([constraintId]);
        });
        return button;
    }

    /** Row click — the same additive semantics as badge clicks (`toggleSelection`). */
    private selectRow(id: number, additive: boolean): void {
        const selected = new Set(this.editor.annotations.selectedConstraintIds);
        if (additive) {
            if (!selected.delete(id)) selected.add(id);
        } else {
            selected.clear();
            selected.add(id);
        }
        this.editor.annotations.selectConstraints(selected);
    }
}
