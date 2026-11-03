// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    command,
    type I18nKeys,
    type IApplication,
    type ICommand,
    PubSub,
} from "@chili3d/core";
import { div, input, label, p, select } from "@chili3d/element";
import { WIND_DERATE_RULE } from "./capacity";
import { getCraneById, MCT88, TOWER_CRANES } from "./catalogue";
import { PLANNING_DISCLAIMER } from "./disclaimer";
import type { TowerI18nKey } from "./i18n/keys";
import { t } from "./i18n/translate";
import {
    type CraneEvaluation,
    evaluateCrane,
    type Pick,
    type PickEvaluation,
    type PickPoint,
    type PickRadiusSource,
    type PickStatus,
} from "./pickEngine";
import { loadSampleSitePicks } from "./sampleSite";
import {
    buildSelectionMatrix,
    type SelectionMatrix,
    type SelectionReason,
    selectionReason,
} from "./selectionMatrix";
import type { SourceDocument, TowerCrane } from "./types";

const OVERVIEW_SOURCE_ID = "datasheetOverview";

/**
 * Resolve the document that supplies the capacity data. Chart cranes point at
 * the chart row's own provenance, which can be a different page (MCT 85 F5:
 * overview p. 1, load curves p. 3) from the overview source. Tip-load cranes
 * fall back to the overview document.
 */
function capacitySource(crane: TowerCrane): SourceDocument {
    const firstChart = crane.loadChart?.[0];
    const provenance = firstChart?.jibM.provenance ?? firstChart?.points[0]?.radiusM.provenance;
    if (provenance?.kind === "source") {
        const source = crane.sources[provenance.sourceId];
        if (source !== undefined) return source;
    }
    return crane.sources[OVERVIEW_SOURCE_ID];
}

/**
 * The crane-specific content behind the dialog's source, default-jib and
 * capacity-method notes. Extracted from the DOM code so the selection can be
 * tested without registering the plugin locale.
 */
export type CraneDialogNotes = {
    sourceDocument: string;
    sourcePage: number;
    defaultJibKind: "source" | "indicative";
    defaultJibDetail: string;
    capacityMethod: "chart" | "tip-load";
    capacitySourceDocument: string;
    capacitySourcePage: number;
};

export function craneDialogNotes(crane: TowerCrane): CraneDialogNotes {
    const overview = crane.sources[OVERVIEW_SOURCE_ID];
    const provenance = crane.defaultJibM.provenance;
    const capacity = capacitySource(crane);

    let defaultJibDetail: string;
    if (provenance.kind === "indicative") {
        defaultJibDetail = provenance.basis;
    } else {
        const document = crane.sources[provenance.sourceId];
        defaultJibDetail = `${document.document}, p. ${document.page}`;
    }

    return {
        sourceDocument: overview.document,
        sourcePage: overview.page,
        defaultJibKind: provenance.kind,
        defaultJibDetail,
        capacityMethod: crane.loadChart ? "chart" : "tip-load",
        capacitySourceDocument: capacity.document,
        capacitySourcePage: capacity.page,
    };
}

const STATUS_I18N: Record<PickStatus, TowerI18nKey> = {
    PASS: "tower.status.pass",
    FAIL: "tower.status.fail",
    OUT_OF_RANGE: "tower.status.outOfRange",
    INVALID: "tower.status.invalid",
};

const GOVERNING_I18N: Record<PickRadiusSource, TowerI18nKey> = {
    supply: "tower.dialog.governingSupply",
    drop: "tower.dialog.governingDrop",
    legacy: "tower.dialog.governingLegacy",
};

const REASON_I18N: Record<SelectionReason, TowerI18nKey> = {
    "invalid-load": "tower.reason.invalidLoad",
    "invalid-wind": "tower.reason.invalidWind",
    "invalid-coordinate": "tower.reason.invalidCoordinate",
    "missing-coordinate": "tower.reason.missingCoordinate",
    "missing-location": "tower.reason.missingLocation",
    "invalid-mast": "tower.reason.invalidMast",
    "invalid-radius": "tower.reason.invalidRadius",
    "jib-outside-published-range": "tower.reason.jibOutsideRange",
    "invalid-capacity": "tower.reason.invalidCapacity",
    "over-capacity": "tower.reason.overCapacity",
    "out-of-range": "tower.reason.outOfRange",
};

function statusColor(status: PickStatus): string {
    return status === "PASS" ? "#1b7f3a" : status === "FAIL" ? "#b42318" : "#8a5a00";
}

type PickRowControls = {
    label: string;
    load: HTMLInputElement;
    supplyX: HTMLInputElement;
    supplyY: HTMLInputElement;
    dropX: HTMLInputElement;
    dropY: HTMLInputElement;
    supplyRadius: HTMLTableCellElement;
    dropRadius: HTMLTableCellElement;
    governingRadius: HTMLTableCellElement;
    capacity: HTMLTableCellElement;
    utilisation: HTMLTableCellElement;
    status: HTMLTableCellElement;
};

type MatrixRowControls = {
    craneId: string;
    pickCells: HTMLTableCellElement[];
    overall: HTMLTableCellElement;
};

function createCell(tag: "td" | "th", text = "", role?: string): HTMLTableCellElement {
    const cell = document.createElement(tag);
    cell.textContent = text;
    cell.style.padding = "4px 6px";
    cell.style.borderBottom = "1px solid #d8dde5";
    cell.style.textAlign = "left";
    if (role !== undefined) cell.setAttribute("data-role", role);
    return cell;
}

function createInput(
    value: string,
    step: string,
    role: string,
    width = "76px",
    min?: string,
): HTMLInputElement {
    const element = input({ type: "number", value, step });
    if (min !== undefined) element.min = min;
    element.setAttribute("data-role", role);
    element.style.width = width;
    return element;
}

/**
 * Read a numeric input without turning a blank field into zero. Chromium
 * reports a malformed entry such as "1e" as an empty value with `badInput`
 * set; both blank and bad input stay invalid.
 */
function readNumber(element: HTMLInputElement): number {
    if (element.validity.badInput) return Number.NaN;
    const text = element.value.trim();
    return text === "" ? Number.NaN : Number(text);
}

function formatRadius(radiusM: number | null): string {
    return radiusM === null ? "-" : `${radiusM.toFixed(2)} m`;
}

function formatGoverningRadius(radiusM: number | null, governing: PickRadiusSource | null): string {
    if (radiusM === null) return "-";
    if (governing === null) return formatRadius(radiusM);
    return t("tower.dialog.governingValue", radiusM.toFixed(2), t(GOVERNING_I18N[governing]));
}

function pointValue(point: PickPoint | undefined, axis: "x" | "y"): string {
    return point === undefined ? "" : String(point[axis]);
}

@command({
    key: "tower.pick" as CommandKeys,
    icon: {
        type: "path",
        value: "icons/tower.svg",
    },
    helpText: "tower.description",
})
export class TowerPickCheckCommand implements ICommand {
    execute(_application: IApplication): Promise<void> {
        const content = div();
        content.style.display = "grid";
        content.style.gap = "10px";
        content.style.minWidth = "1040px";

        const disclaimer = p(PLANNING_DISCLAIMER);
        disclaimer.style.fontWeight = "700";
        disclaimer.style.margin = "0";

        const intro = p(t("tower.dialog.intro"));
        intro.style.margin = "0";

        const sampleSite = loadSampleSitePicks();
        if (!sampleSite.ok) {
            const detail = sampleSite.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
            const error = p(t("tower.dialog.sampleSiteError", detail));
            error.style.margin = "0";
            error.style.fontWeight = "600";
            error.style.color = "#b42318";

            content.append(disclaimer, intro, error);
            PubSub.default.pub("showDialog", "tower.dialog.title" as I18nKeys, content, [
                { content: "tower.dialog.close" as I18nKeys },
            ]);
            return Promise.resolve();
        }

        const controls = div();
        controls.style.display = "flex";
        controls.style.flexWrap = "wrap";
        controls.style.gap = "12px";
        controls.style.alignItems = "end";

        const craneSelect = select();
        for (const crane of TOWER_CRANES) {
            const item = document.createElement("option");
            item.value = crane.id;
            item.textContent = crane.name;
            craneSelect.append(item);
        }
        craneSelect.value = MCT88.id;

        const craneField = label(t("tower.dialog.crane"));
        craneField.style.display = "grid";
        craneField.append(craneSelect);

        const jibInput = createInput(String(MCT88.defaultJibM.value), "0.1", "jib", "76px", "0");
        const jibField = label(t("tower.dialog.jib"));
        jibField.style.display = "grid";
        jibField.append(jibInput);

        const mastXInput = createInput("", "0.1", "mast-x");
        mastXInput.placeholder = t("tower.dialog.mastHint");
        const mastXField = label(t("tower.dialog.mastX"));
        mastXField.style.display = "grid";
        mastXField.append(mastXInput);

        const mastYInput = createInput("", "0.1", "mast-y");
        mastYInput.placeholder = t("tower.dialog.mastHint");
        const mastYField = label(t("tower.dialog.mastY"));
        mastYField.style.display = "grid";
        mastYField.append(mastYInput);

        const windInput = createInput("", "1", "wind", "76px", "0");
        windInput.placeholder = t("tower.dialog.windHint");
        const windField = label(t("tower.dialog.wind"));
        windField.style.display = "grid";
        windField.append(windInput);

        controls.append(craneField, jibField, mastXField, mastYField, windField);

        const table = document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";
        table.style.fontSize = "12px";

        const header = document.createElement("thead");
        const headerRow = document.createElement("tr");
        for (const key of [
            "tower.dialog.pick",
            "tower.dialog.load",
            "tower.dialog.supply",
            "tower.dialog.drop",
            "tower.dialog.supplyRadius",
            "tower.dialog.dropRadius",
            "tower.dialog.governingRadius",
            "tower.dialog.capacity",
            "tower.dialog.utilisation",
            "tower.dialog.status",
        ] as TowerI18nKey[]) {
            headerRow.append(createCell("th", t(key)));
        }
        header.append(headerRow);

        const body = document.createElement("tbody");
        const rows: PickRowControls[] = [];

        for (const pick of sampleSite.picks) {
            const row = document.createElement("tr");
            row.setAttribute("data-pick", pick.label ?? "");

            const load = createInput(String(pick.loadT), "0.1", "load", "64px", "0");
            const supplyX = createInput(pointValue(pick.supply, "x"), "0.1", "supply-x", "58px");
            const supplyY = createInput(pointValue(pick.supply, "y"), "0.1", "supply-y", "58px");
            const dropX = createInput(pointValue(pick.drop, "x"), "0.1", "drop-x", "58px");
            const dropY = createInput(pointValue(pick.drop, "y"), "0.1", "drop-y", "58px");
            supplyY.style.marginLeft = "4px";
            dropY.style.marginLeft = "4px";

            const supplyRadius = createCell("td", "-", "supply-radius");
            const dropRadius = createCell("td", "-", "drop-radius");
            const governingRadius = createCell("td", "-", "governing-radius");
            const capacity = createCell("td", "-", "capacity");
            const utilisation = createCell("td", "-", "utilisation");
            const status = createCell("td", "-", "status");

            const supplyCell = createCell("td");
            const dropCell = createCell("td");
            const loadCell = createCell("td");
            supplyCell.append(supplyX, supplyY);
            dropCell.append(dropX, dropY);
            loadCell.append(load);

            row.append(
                createCell("td", pick.label ?? ""),
                loadCell,
                supplyCell,
                dropCell,
                supplyRadius,
                dropRadius,
                governingRadius,
                capacity,
                utilisation,
                status,
            );
            body.append(row);
            rows.push({
                label: pick.label ?? "",
                load,
                supplyX,
                supplyY,
                dropX,
                dropY,
                supplyRadius,
                dropRadius,
                governingRadius,
                capacity,
                utilisation,
                status,
            });
        }

        table.append(header, body);

        const summary = p();
        summary.style.fontWeight = "600";
        summary.style.margin = "0";

        const matrixTitle = p(t("tower.matrix.title"));
        matrixTitle.style.fontWeight = "700";
        matrixTitle.style.margin = "0";

        const matrixHint = p(t("tower.matrix.hint"));
        matrixHint.style.margin = "0";
        matrixHint.style.fontSize = "12px";

        const matrixSummary = p();
        matrixSummary.style.margin = "0";
        matrixSummary.style.fontWeight = "600";
        matrixSummary.setAttribute("data-role", "matrix-summary");

        const matrixWrapper = div();
        matrixWrapper.style.overflowX = "auto";

        const matrixTable = document.createElement("table");
        matrixTable.style.width = "100%";
        matrixTable.style.borderCollapse = "collapse";
        matrixTable.style.fontSize = "12px";
        matrixTable.style.minWidth = "1100px";

        const matrixHeader = document.createElement("thead");
        const matrixHeaderRow = document.createElement("tr");
        matrixHeaderRow.append(
            createCell("th", t("tower.matrix.crane")),
            createCell("th", t("tower.matrix.jib")),
        );
        for (const pick of sampleSite.picks) {
            const cell = createCell("th", pick.label ?? "");
            cell.setAttribute("data-pick-column", pick.label ?? "");
            matrixHeaderRow.append(cell);
        }
        matrixHeaderRow.append(createCell("th", t("tower.matrix.overall")));
        matrixHeader.append(matrixHeaderRow);

        const matrixBody = document.createElement("tbody");
        const matrixRows: MatrixRowControls[] = [];

        for (const crane of TOWER_CRANES) {
            const row = document.createElement("tr");
            row.setAttribute("data-crane", crane.id);

            const nameCell = createCell("td", crane.name);
            nameCell.style.whiteSpace = "nowrap";
            nameCell.style.verticalAlign = "top";

            const jibKind =
                crane.defaultJibM.provenance.kind === "indicative"
                    ? t("tower.matrix.indicative")
                    : t("tower.matrix.source");
            const jibCell = createCell("td", `${crane.defaultJibM.value} m (${jibKind})`);
            jibCell.setAttribute("data-jib-provenance", crane.defaultJibM.provenance.kind);
            jibCell.style.whiteSpace = "nowrap";
            jibCell.style.verticalAlign = "top";

            const pickCells: HTMLTableCellElement[] = [];
            for (const pick of sampleSite.picks) {
                const cell = createCell("td", "-");
                cell.setAttribute("data-role", "matrix-cell");
                cell.setAttribute("data-pick-cell", pick.label ?? "");
                cell.style.verticalAlign = "top";
                cell.style.minWidth = "132px";
                pickCells.push(cell);
            }

            const overall = createCell("td", "-");
            overall.setAttribute("data-role", "matrix-overall");
            overall.style.verticalAlign = "top";
            overall.style.minWidth = "150px";

            row.append(nameCell, jibCell, ...pickCells, overall);
            matrixBody.append(row);
            matrixRows.push({ craneId: crane.id, pickCells, overall });
        }

        matrixTable.append(matrixHeader, matrixBody);
        matrixWrapper.append(matrixTable);

        const source = p();
        source.style.margin = "0";
        source.style.fontSize = "12px";

        const jibProvenance = p();
        jibProvenance.style.margin = "0";
        jibProvenance.style.fontSize = "12px";

        const capacityMethod = p();
        capacityMethod.style.margin = "0";
        capacityMethod.style.fontSize = "12px";

        const capacitySourceLine = p();
        capacitySourceLine.style.margin = "0";
        capacitySourceLine.style.fontSize = "12px";

        const windRule = p(
            t("tower.dialog.windRule", WIND_DERATE_RULE.factor, WIND_DERATE_RULE.thresholdKmh),
        );
        windRule.style.margin = "0";
        windRule.style.fontSize = "12px";

        const invalidHint = p(t("tower.dialog.invalidHint"));
        invalidHint.style.margin = "0";
        invalidHint.style.fontSize = "12px";

        function selectedCrane() {
            return getCraneById(craneSelect.value) ?? MCT88;
        }

        /**
         * The source and default-jib notes must describe the selected crane, not
         * the MCT 88 baseline. The default jib is a project choice for both
         * catalogue entries, so its provenance is always shown explicitly.
         */
        function updateCraneNotes(crane: TowerCrane): void {
            const notes = craneDialogNotes(crane);
            source.textContent = t("tower.dialog.sourceLine", notes.sourceDocument, notes.sourcePage);

            jibProvenance.textContent =
                notes.defaultJibKind === "indicative"
                    ? t("tower.dialog.indicativeJib", notes.defaultJibDetail)
                    : t("tower.dialog.sourceJib", notes.defaultJibDetail);

            capacityMethod.textContent = t(
                notes.capacityMethod === "chart"
                    ? "tower.dialog.capacityMethodChart"
                    : "tower.dialog.capacityMethodTipLoad",
            );

            capacitySourceLine.textContent = t(
                "tower.dialog.capacitySourceLine",
                notes.capacitySourceDocument,
                notes.capacitySourcePage,
            );
        }

        function readPicks(): Pick[] {
            return rows.map((row) => ({
                label: row.label,
                loadT: readNumber(row.load),
                supply: { x: readNumber(row.supplyX), y: readNumber(row.supplyY) },
                drop: { x: readNumber(row.dropX), y: readNumber(row.dropY) },
            }));
        }

        function readMast(): PickPoint | undefined {
            const x = readNumber(mastXInput);
            const y = readNumber(mastYInput);
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
        }

        function renderMatrixCell(cell: HTMLTableCellElement, result: PickEvaluation): void {
            cell.replaceChildren();

            const status = document.createElement("div");
            status.textContent = t(STATUS_I18N[result.status]);
            status.style.fontWeight = "600";
            status.style.color = statusColor(result.status);

            const measures = document.createElement("div");
            const capacity = result.capacityT === null ? "-" : `${result.capacityT.toFixed(2)} t`;
            const utilisation =
                result.utilisationPct === null ? "-" : `${result.utilisationPct.toFixed(1)} %`;
            measures.textContent = `${capacity} · ${utilisation}`;

            const radius = document.createElement("div");
            radius.textContent = formatGoverningRadius(result.radiusM, result.governing);

            cell.append(status, measures, radius);

            const reason = selectionReason(result);
            if (reason !== undefined) {
                const reasonLine = document.createElement("div");
                reasonLine.textContent = t(REASON_I18N[reason]);
                reasonLine.style.fontSize = "11px";
                reasonLine.style.color = "#8a5a00";
                cell.append(reasonLine);
            }

            cell.setAttribute("data-matrix-status", result.status);
            cell.setAttribute("data-matrix-issue", result.issue ?? "");
            cell.setAttribute(
                "data-matrix-capacity",
                result.capacityT === null ? "" : result.capacityT.toFixed(2),
            );
            cell.setAttribute(
                "data-matrix-utilisation",
                result.utilisationPct === null ? "" : result.utilisationPct.toFixed(1),
            );
            cell.setAttribute("data-matrix-radius", result.radiusM === null ? "" : result.radiusM.toFixed(2));
            cell.setAttribute("data-matrix-governing", result.governing ?? "");
            cell.setAttribute("data-matrix-reason", reason ?? "");
        }

        function renderMatrixRow(controls: MatrixRowControls, evaluation: CraneEvaluation): void {
            evaluation.picks.forEach((result, index) => {
                const cell = controls.pickCells[index];
                if (cell !== undefined) renderMatrixCell(cell, result);
            });

            const total = evaluation.picks.length;
            const passing = evaluation.picks.filter((result) => result.status === "PASS").length;
            const invalid = evaluation.picks.filter((result) => result.status === "INVALID").length;
            const allInvalid = total > 0 && invalid === total;

            if (total === 0) {
                controls.overall.textContent = t("tower.matrix.rowNoPicks");
            } else if (evaluation.allPass) {
                controls.overall.textContent = t("tower.matrix.rowPass", passing, total);
            } else if (allInvalid) {
                controls.overall.textContent = t("tower.matrix.rowInvalid", passing, total, invalid);
            } else {
                controls.overall.textContent = t("tower.matrix.rowFail", passing, total);
            }
            controls.overall.style.fontWeight = "600";
            controls.overall.style.color = evaluation.allPass ? "#1b7f3a" : "#8a5a00";
            controls.overall.setAttribute("data-matrix-all-pass", String(evaluation.allPass));
            controls.overall.setAttribute("data-matrix-passing", String(passing));
            controls.overall.setAttribute("data-matrix-total", String(total));
        }

        function renderMatrix(matrix: SelectionMatrix): void {
            const rowsById = new Map(matrix.rows.map((row) => [row.craneId, row]));
            for (const controls of matrixRows) {
                const evaluation = rowsById.get(controls.craneId);
                if (evaluation !== undefined) renderMatrixRow(controls, evaluation);
            }

            matrixSummary.setAttribute("data-state", matrix.state);
            matrixSummary.setAttribute("data-passing-cranes", String(matrix.passingCraneCount));
            matrixSummary.setAttribute("data-crane-count", String(matrix.craneCount));
            matrixSummary.style.color =
                matrix.state === "cranes-pass"
                    ? "#1b7f3a"
                    : matrix.state === "no-crane-passes"
                      ? "#b42318"
                      : "#8a5a00";

            switch (matrix.state) {
                case "no-picks":
                    matrixSummary.textContent = t("tower.matrix.noPicks");
                    break;
                case "invalid-picks":
                    matrixSummary.textContent = t("tower.matrix.invalidPicks");
                    break;
                case "missing-mast":
                    matrixSummary.textContent = t("tower.matrix.missingMast");
                    break;
                case "no-crane-passes":
                    matrixSummary.textContent = t("tower.matrix.noCranePasses", matrix.craneCount);
                    break;
                case "cranes-pass":
                    matrixSummary.textContent = t(
                        "tower.matrix.cranesPass",
                        matrix.passingCraneCount,
                        matrix.craneCount,
                        matrix.allPassCraneNames.join(", "),
                    );
                    break;
            }
        }

        function recalculate(): void {
            const crane = selectedCrane();
            const jibM = readNumber(jibInput);
            const windText = windInput.value.trim();
            // Chromium reports malformed or incomplete numeric entries such as
            // "1e" as an empty value with badInput set. That is invalid wind,
            // not the genuine empty field that means "no wind derate".
            let windKmh: number | null;
            if (windInput.validity.badInput) {
                windKmh = Number.NaN;
            } else {
                windKmh = windText === "" ? null : Number(windText);
            }
            const picks = readPicks();
            const mast = readMast();
            const evaluation = evaluateCrane(crane, picks, {
                jibM,
                windKmh,
                mast,
            });

            evaluation.picks.forEach((result, index) => {
                const row = rows[index];
                row.supplyRadius.textContent = formatRadius(result.supplyRadiusM);
                row.dropRadius.textContent = formatRadius(result.dropRadiusM);
                row.governingRadius.textContent = formatGoverningRadius(result.radiusM, result.governing);
                row.governingRadius.setAttribute("data-governing", result.governing ?? "none");
                row.capacity.textContent =
                    result.capacityT === null ? "-" : `${result.capacityT.toFixed(2)} t`;
                row.utilisation.textContent =
                    result.utilisationPct === null ? "-" : `${result.utilisationPct.toFixed(1)} %`;
                row.status.textContent = t(STATUS_I18N[result.status]);
                row.status.setAttribute("data-status", result.status);
                row.status.setAttribute("data-issue", result.issue ?? "");
                row.status.style.fontWeight = "600";
                row.status.style.color = statusColor(result.status);
            });

            const passing = evaluation.picks.filter((result) => result.status === "PASS").length;
            summary.textContent = t("tower.dialog.summary", passing, evaluation.picks.length);
            summary.setAttribute("data-all-pass", String(evaluation.allPass));

            // The catalogue matrix compares every crane at its own default jib;
            // the selected-crane jib input above only drives the detail table.
            const matrix = buildSelectionMatrix(TOWER_CRANES, picks, { windKmh, mast });
            renderMatrix(matrix);
        }

        craneSelect.addEventListener("change", () => {
            const crane = selectedCrane();
            jibInput.value = String(crane.defaultJibM.value);
            updateCraneNotes(crane);
            recalculate();
        });
        for (const row of rows) {
            for (const element of [row.load, row.supplyX, row.supplyY, row.dropX, row.dropY]) {
                element.addEventListener("input", recalculate);
            }
        }
        for (const element of [jibInput, mastXInput, mastYInput, windInput]) {
            element.addEventListener("input", recalculate);
        }

        updateCraneNotes(selectedCrane());
        recalculate();

        content.append(
            disclaimer,
            intro,
            controls,
            table,
            summary,
            matrixTitle,
            matrixHint,
            matrixSummary,
            matrixWrapper,
            source,
            jibProvenance,
            capacityMethod,
            capacitySourceLine,
            windRule,
            invalidHint,
        );

        PubSub.default.pub("showDialog", "tower.dialog.title" as I18nKeys, content, [
            { content: "tower.dialog.close" as I18nKeys },
        ]);

        return Promise.resolve();
    }
}
