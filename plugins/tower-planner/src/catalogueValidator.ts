// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CraneCatalogue, SourceDocument, SourcedNumber } from "./types";

export type CatalogueValidationIssue = {
    path: string;
    message: string;
};

export type CatalogueValidationResult =
    | { ok: true; catalogue: CraneCatalogue; errors: [] }
    | { ok: false; errors: CatalogueValidationIssue[] };

type ValidationContext = {
    sources: Record<string, SourceDocument>;
    errors: CatalogueValidationIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

/** Read a dynamic JSON field without relying on dot-access to an index signature. */
function field(record: Record<string, unknown>, key: string): unknown {
    return record[key];
}

function addError(context: ValidationContext, path: string, message: string): void {
    context.errors.push({ path, message });
}

function validateSourceDocument(
    source: unknown,
    path: string,
    context: ValidationContext,
): source is SourceDocument {
    if (!isRecord(source)) {
        addError(context, path, "Source metadata must be an object.");
        return false;
    }

    let valid = true;
    const document = field(source, "document");
    if (!isNonEmptyString(document)) {
        addError(context, `${path}.document`, "Source must name the brochure or document.");
        valid = false;
    }

    const page = field(source, "page");
    if (typeof page !== "number" || !Number.isInteger(page) || page <= 0) {
        addError(context, `${path}.page`, "Source must include a positive integer page number.");
        valid = false;
    }

    const section = field(source, "section");
    if (section !== undefined && !isNonEmptyString(section)) {
        addError(context, `${path}.section`, "Optional source section must be a non-empty string.");
        valid = false;
    }

    const url = field(source, "url");
    if (url !== undefined && !isNonEmptyString(url)) {
        addError(context, `${path}.url`, "Optional source URL must be a non-empty string.");
        valid = false;
    }

    const note = field(source, "note");
    if (note !== undefined && !isNonEmptyString(note)) {
        addError(context, `${path}.note`, "Optional source note must be a non-empty string.");
        valid = false;
    }

    return valid;
}

function validateSources(
    sources: unknown,
    path: string,
    context: ValidationContext,
): Record<string, SourceDocument> {
    if (!isRecord(sources)) {
        addError(context, path, "Crane entries must declare a sources object.");
        return {};
    }

    for (const [sourceId, source] of Object.entries(sources)) {
        if (!isNonEmptyString(sourceId)) {
            addError(context, `${path}.${sourceId}`, "Source ids must be non-empty strings.");
        }
        validateSourceDocument(source, `${path}.${sourceId}`, context);
    }

    return sources as Record<string, SourceDocument>;
}

function validateProvenance(value: unknown, path: string, context: ValidationContext): void {
    if (!isRecord(value)) {
        addError(context, path, "Numeric field is missing provenance (source or INDICATIVE).");
        return;
    }

    const kind = field(value, "kind");
    if (kind === "source") {
        const sourceId = field(value, "sourceId");
        if (!isNonEmptyString(sourceId)) {
            addError(context, `${path}.sourceId`, "Source provenance must name a sourceId.");
            return;
        }
        // Use an own-property check: inherited keys such as `__proto__`,
        // `toString` or `constructor` must not masquerade as declared sources.
        if (!Object.hasOwn(context.sources, sourceId)) {
            addError(context, `${path}.sourceId`, `Unknown sourceId "${sourceId}".`);
        }
        return;
    }

    if (kind === "indicative") {
        const basis = field(value, "basis");
        if (!isNonEmptyString(basis)) {
            addError(context, `${path}.basis`, "INDICATIVE provenance must explain its basis.");
        }
        return;
    }

    addError(context, `${path}.kind`, 'Provenance kind must be "source" or "indicative".');
}

function validateNumericNode(value: unknown, path: string, context: ValidationContext): void {
    if (isRecord(value) && "value" in value) {
        const numericValue = field(value, "value");
        if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
            addError(context, path, "Sourced numeric values must be finite numbers.");
        }
        if (!("provenance" in value)) {
            addError(context, path, "Numeric field is missing provenance (source or INDICATIVE).");
            return;
        }
        validateProvenance(field(value, "provenance"), `${path}.provenance`, context);
        return;
    }

    if (typeof value === "number") {
        addError(
            context,
            path,
            "Numeric field is not wrapped in a sourced/INDICATIVE value; every catalogue number needs provenance.",
        );
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            validateNumericNode(item, `${path}[${index}]`, context);
        });
        return;
    }

    if (isRecord(value)) {
        for (const [key, child] of Object.entries(value)) {
            // Source metadata is validated separately; its page number is not a
            // crane specification and must not need its own provenance.
            if (key === "sources") continue;
            validateNumericNode(child, path ? `${path}.${key}` : key, context);
        }
    }
}

function readNumberField(
    value: unknown,
    path: string,
    context: ValidationContext,
): SourcedNumber | undefined {
    if (!isRecord(value)) {
        addError(context, path, "Required sourced/INDICATIVE number is missing or malformed.");
        return undefined;
    }

    const numericValue = field(value, "value");
    if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
        addError(context, path, "Required sourced/INDICATIVE number is missing or malformed.");
        return undefined;
    }

    return value as unknown as SourcedNumber;
}

function isNotStated(value: unknown): value is { kind: "notStated"; reason: string } {
    return isRecord(value) && field(value, "kind") === "notStated";
}

/**
 * A dimension or height may be a sourced/INDICATIVE number or an explicit
 * `notStated` object with a reason. A zero, a blank or a bare number is not an
 * acceptable substitute for an undocumented value.
 */
function validateCatalogueNumber(
    value: unknown,
    path: string,
    context: ValidationContext,
    label: string,
): void {
    if (isNotStated(value)) {
        if ("value" in value) {
            addError(context, path, `${label} cannot be both not stated and numeric.`);
        }
        if (!isNonEmptyString(field(value, "reason"))) {
            addError(context, `${path}.reason`, `${label} must explain why it is not stated.`);
        }
        return;
    }

    const number = readNumberField(value, path, context);
    if (number && number.value <= 0) {
        addError(context, `${path}.value`, `${label} must be greater than zero.`);
    }
}

function validateHeaviestComponent(value: unknown, path: string, context: ValidationContext): void {
    if (isNotStated(value)) {
        if ("name" in value || "massT" in value) {
            addError(context, path, "A not-stated heaviest component cannot also carry a name or mass.");
        }
        if (!isNonEmptyString(field(value, "reason"))) {
            addError(
                context,
                `${path}.reason`,
                "A not-stated heaviest component must explain why it is not stated.",
            );
        }
        return;
    }

    if (!isRecord(value)) {
        addError(context, path, "Heaviest erection component must be an object or a notStated value.");
        return;
    }

    if (!isNonEmptyString(field(value, "name"))) {
        addError(context, `${path}.name`, "Heaviest erection component must have a name.");
    }

    const mass = readNumberField(field(value, "massT"), `${path}.massT`, context);
    if (mass && mass.value <= 0) {
        addError(
            context,
            `${path}.massT.value`,
            "Heaviest erection component mass must be greater than zero.",
        );
    }

    const note = field(value, "note");
    if (note !== undefined && typeof note !== "string") {
        addError(context, `${path}.note`, "Optional component note must be a string.");
    }
}

function validateCombinedPackage(value: unknown, path: string, context: ValidationContext): void {
    if (value === undefined) return;

    if (!isRecord(value)) {
        addError(context, path, "Combined transport package must be an object.");
        return;
    }

    if (!isNonEmptyString(field(value, "name"))) {
        addError(context, `${path}.name`, "Combined transport package must have a name.");
    }

    const mass = readNumberField(field(value, "massT"), `${path}.massT`, context);
    if (mass && mass.value <= 0) {
        addError(
            context,
            `${path}.massT.value`,
            "Combined transport package mass must be greater than zero.",
        );
    }

    const note = field(value, "note");
    if (note !== undefined && typeof note !== "string") {
        addError(context, `${path}.note`, "Optional package note must be a string.");
    }
}

/**
 * Tip loads are transcribed decimal labels, not independently rounded
 * calculations. Only floating-point noise is tolerated: a larger tolerance
 * (for example half a printed 0.01 t unit) could hide a real increase between
 * adjacent published jib lengths.
 */
const TIP_LOAD_TOLERANCE_T = 1e-9;

function validateTipLoadTable(
    table: unknown,
    path: string,
    context: ValidationContext,
    maxJibM: number | undefined,
): void {
    if (!Array.isArray(table) || table.length === 0) {
        addError(context, path, "Tip-load table must contain at least one row.");
        return;
    }

    let previousJibM = Number.NEGATIVE_INFINITY;
    let previousTipT = Number.POSITIVE_INFINITY;
    for (let index = 0; index < table.length; index++) {
        const row = table[index];
        const rowPath = `${path}[${index}]`;
        if (!isRecord(row)) {
            addError(context, rowPath, "Tip-load row must be an object.");
            continue;
        }

        const jib = readNumberField(field(row, "jibM"), `${rowPath}.jibM`, context);
        const tip = readNumberField(field(row, "tipT"), `${rowPath}.tipT`, context);

        if (jib) {
            if (jib.value <= 0) {
                addError(context, `${rowPath}.jibM.value`, "Jib length must be greater than zero.");
            }
            if (jib.value <= previousJibM) {
                addError(
                    context,
                    `${rowPath}.jibM.value`,
                    "Tip-load rows must be in strictly ascending jib-length order.",
                );
            }
            previousJibM = jib.value;
        }

        if (tip) {
            if (tip.value <= 0) {
                addError(context, `${rowPath}.tipT.value`, "Tip load must be greater than zero.");
            } else {
                if (tip.value > previousTipT + TIP_LOAD_TOLERANCE_T) {
                    addError(
                        context,
                        `${rowPath}.tipT.value`,
                        "Tip load must not increase as the jib length increases.",
                    );
                }
                previousTipT = tip.value;
            }
        }
    }

    const lastRow = table[table.length - 1];
    if (!isRecord(lastRow)) return;

    const lastJibField = field(lastRow, "jibM");
    if (maxJibM !== undefined && isRecord(lastJibField)) {
        const lastJib = field(lastJibField, "value");
        if (typeof lastJib === "number" && Number.isFinite(lastJib) && lastJib > maxJibM + 1e-9) {
            addError(
                context,
                `${path}[${table.length - 1}].jibM.value`,
                "Tip-load table cannot extend beyond the declared maximum jib length.",
            );
        }
    }
}

function validateLoadChart(
    chart: unknown,
    path: string,
    context: ValidationContext,
    maxJibM: number | undefined,
    maxCapacityT: number | undefined,
    tipLoadTable: unknown,
): void {
    if (chart === undefined) return;

    if (!Array.isArray(chart) || chart.length === 0) {
        addError(context, path, "Load chart must contain at least one jib row.");
        return;
    }

    // A chart is only meaningful for a jib length that also appears in the
    // tip-load summary. This prevents a chart row from being attached to a
    // configuration the crane does not publish.
    const tipJibs = new Set<number>();
    if (Array.isArray(tipLoadTable)) {
        for (const row of tipLoadTable) {
            if (!isRecord(row)) continue;
            const jibNode = field(row, "jibM");
            if (!isRecord(jibNode)) continue;
            const value = field(jibNode, "value");
            if (typeof value === "number" && Number.isFinite(value)) tipJibs.add(value);
        }
    }

    let previousJibM = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < chart.length; index++) {
        const row = chart[index];
        const rowPath = `${path}[${index}]`;
        if (!isRecord(row)) {
            addError(context, rowPath, "Load-chart jib row must be an object.");
            continue;
        }

        const jib = readNumberField(field(row, "jibM"), `${rowPath}.jibM`, context);
        if (jib) {
            if (jib.value <= 0) {
                addError(
                    context,
                    `${rowPath}.jibM.value`,
                    "Load-chart jib length must be greater than zero.",
                );
            }
            if (jib.value <= previousJibM) {
                addError(
                    context,
                    `${rowPath}.jibM.value`,
                    "Load-chart rows must be in strictly ascending jib-length order.",
                );
            }
            if (maxJibM !== undefined && jib.value > maxJibM + 1e-9) {
                addError(
                    context,
                    `${rowPath}.jibM.value`,
                    "Load-chart jib length cannot exceed the declared maximum jib length.",
                );
            }
            if (tipJibs.size > 0 && !tipJibs.has(jib.value)) {
                addError(
                    context,
                    `${rowPath}.jibM.value`,
                    "Load-chart jib length must match a tip-load table row.",
                );
            }
            previousJibM = jib.value;
        }

        const minRadius = readNumberField(field(row, "minRadiusM"), `${rowPath}.minRadiusM`, context);
        if (minRadius) {
            if (minRadius.value <= 0) {
                addError(
                    context,
                    `${rowPath}.minRadiusM.value`,
                    "Load-chart minimum radius must be greater than zero.",
                );
            }
            if (jib && minRadius.value > jib.value + 1e-9) {
                addError(
                    context,
                    `${rowPath}.minRadiusM.value`,
                    "Load-chart minimum radius cannot exceed its jib length.",
                );
            }
        }

        const points = field(row, "points");
        if (!Array.isArray(points) || points.length === 0) {
            addError(context, `${rowPath}.points`, "Load-chart row must contain at least one radius point.");
            continue;
        }

        let previousRadiusM = Number.NEGATIVE_INFINITY;
        let previousCapacityT = Number.POSITIVE_INFINITY;
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const point = points[pointIndex];
            const pointPath = `${rowPath}.points[${pointIndex}]`;
            if (!isRecord(point)) {
                addError(context, pointPath, "Load-chart point must be an object.");
                continue;
            }

            const radius = readNumberField(field(point, "radiusM"), `${pointPath}.radiusM`, context);
            const capacity = readNumberField(field(point, "capacityT"), `${pointPath}.capacityT`, context);

            if (radius) {
                if (radius.value <= 0) {
                    addError(
                        context,
                        `${pointPath}.radiusM.value`,
                        "Load-chart radius must be greater than zero.",
                    );
                }
                if (radius.value <= previousRadiusM) {
                    addError(
                        context,
                        `${pointPath}.radiusM.value`,
                        "Load-chart radii must be in strictly ascending order.",
                    );
                }
                if (jib && radius.value > jib.value + 1e-9) {
                    addError(
                        context,
                        `${pointPath}.radiusM.value`,
                        "Load-chart radius cannot exceed its jib length.",
                    );
                }
                // Radii are ascending, so checking the first point against the
                // declared minimum covers the whole row.
                if (pointIndex === 0 && minRadius && radius.value < minRadius.value - 1e-9) {
                    addError(
                        context,
                        `${pointPath}.radiusM.value`,
                        "Load-chart radius cannot be below the declared minimum radius.",
                    );
                }
                previousRadiusM = radius.value;
            }

            if (capacity) {
                if (capacity.value <= 0) {
                    addError(
                        context,
                        `${pointPath}.capacityT.value`,
                        "Load-chart capacity must be greater than zero.",
                    );
                }
                if (maxCapacityT !== undefined && capacity.value > maxCapacityT + 1e-9) {
                    addError(
                        context,
                        `${pointPath}.capacityT.value`,
                        "Load-chart capacity cannot exceed the declared maximum capacity.",
                    );
                }
                if (capacity.value > previousCapacityT + 1e-9) {
                    addError(
                        context,
                        `${pointPath}.capacityT.value`,
                        "Load-chart capacity must not increase with radius.",
                    );
                }
                previousCapacityT = capacity.value;
            }
        }
    }
}

function validateModelGrouping(cranes: readonly unknown[], context: ValidationContext): void {
    const models = new Map<string, { modelName: string; configurations: Set<string>; firstIndex: number }>();

    for (let index = 0; index < cranes.length; index++) {
        const crane = cranes[index];
        if (!isRecord(crane)) continue;

        const modelId = field(crane, "modelId");
        const modelName = field(crane, "modelName");
        const configuration = field(crane, "configuration");
        if (!isNonEmptyString(modelId) || !isNonEmptyString(modelName) || !isNonEmptyString(configuration)) {
            continue;
        }

        const existing = models.get(modelId);
        if (existing === undefined) {
            models.set(modelId, {
                modelName,
                configurations: new Set([configuration]),
                firstIndex: index,
            });
            continue;
        }

        if (existing.modelName !== modelName) {
            addError(
                context,
                `cranes[${index}].modelName`,
                `Model "${modelId}" must use the same modelName as cranes[${existing.firstIndex}].`,
            );
        }
        if (existing.configurations.has(configuration)) {
            addError(
                context,
                `cranes[${index}].configuration`,
                `Configuration "${configuration}" is duplicated for model "${modelId}".`,
            );
        } else {
            existing.configurations.add(configuration);
        }
    }

    const jaso = models.get(JASO_MODEL_ID);
    if (jaso === undefined) {
        addError(context, "cranes", `Catalogue must contain the ${JASO_MODEL_ID} model.`);
    } else if (jaso.configurations.size !== 2) {
        addError(
            context,
            "cranes",
            `The ${JASO_MODEL_ID} model must be represented by exactly two configurations.`,
        );
    }
}

function validateCrane(crane: unknown, index: number, context: ValidationContext): void {
    const path = `cranes[${index}]`;
    if (!isRecord(crane)) {
        addError(context, path, "Crane entry must be an object.");
        return;
    }

    if (!isNonEmptyString(field(crane, "id"))) {
        addError(context, `${path}.id`, "Crane id must be a non-empty string.");
    }
    if (!isNonEmptyString(field(crane, "name"))) {
        addError(context, `${path}.name`, "Crane name must be a non-empty string.");
    }
    if (!isNonEmptyString(field(crane, "standard"))) {
        addError(context, `${path}.standard`, "Crane standard must be a non-empty string.");
    }
    if (!isNonEmptyString(field(crane, "modelId"))) {
        addError(context, `${path}.modelId`, "Crane modelId must be a non-empty string.");
    }
    if (!isNonEmptyString(field(crane, "modelName"))) {
        addError(context, `${path}.modelName`, "Crane modelName must be a non-empty string.");
    }
    if (!isNonEmptyString(field(crane, "configuration"))) {
        addError(context, `${path}.configuration`, "Crane configuration must be a non-empty string.");
    }

    const craneType = field(crane, "craneType");
    if (craneType !== "trolley-jib" && craneType !== "luffing-jib") {
        addError(context, `${path}.craneType`, 'Crane type must be "trolley-jib" or "luffing-jib".');
    }
    if (field(crane, "modelId") === JASO_MODEL_ID && craneType !== "luffing-jib") {
        addError(context, `${path}.craneType`, `The ${JASO_MODEL_ID} model must be a luffing-jib crane.`);
    }

    const sources = validateSources(field(crane, "sources"), `${path}.sources`, context);
    const numericContext: ValidationContext = { sources, errors: context.errors };

    const maxCapacity = readNumberField(field(crane, "maxCapacityT"), `${path}.maxCapacityT`, numericContext);
    if (maxCapacity && maxCapacity.value <= 0) {
        addError(context, `${path}.maxCapacityT.value`, "Maximum capacity must be greater than zero.");
    }

    const maxJib = readNumberField(field(crane, "maxJibLengthM"), `${path}.maxJibLengthM`, numericContext);
    if (maxJib && maxJib.value <= 0) {
        addError(context, `${path}.maxJibLengthM.value`, "Maximum jib length must be greater than zero.");
    }

    const defaultJib = readNumberField(field(crane, "defaultJibM"), `${path}.defaultJibM`, numericContext);
    if (defaultJib) {
        if (defaultJib.value <= 0) {
            addError(context, `${path}.defaultJibM.value`, "Default jib length must be greater than zero.");
        }
        if (maxJib && defaultJib.value > maxJib.value + 1e-9) {
            addError(
                context,
                `${path}.defaultJibM.value`,
                "Default jib length cannot exceed the declared maximum jib length.",
            );
        }
    }

    const tipLoadTable = field(crane, "tipLoadByJib");
    validateTipLoadTable(tipLoadTable, `${path}.tipLoadByJib`, numericContext, maxJib?.value);
    const loadChart = field(crane, "loadChart");
    validateLoadChart(
        loadChart,
        `${path}.loadChart`,
        numericContext,
        maxJib?.value,
        maxCapacity?.value,
        tipLoadTable,
    );

    // A chart-based crane has no capacity data for a jib it did not publish, so
    // the default must be one of the chart's exact configurations.
    if (defaultJib && Array.isArray(loadChart)) {
        const published = loadChart.some((row) => {
            if (!isRecord(row)) return false;
            const jib = field(row, "jibM");
            if (!isRecord(jib)) return false;
            const value = field(jib, "value");
            return typeof value === "number" && Math.abs(value - defaultJib.value) <= 1e-9;
        });
        if (!published) {
            addError(
                context,
                `${path}.defaultJibM.value`,
                "Default jib length must be one of the published load-chart configurations.",
            );
        }
    }

    validateCatalogueNumber(
        field(crane, "heightUnderHookM"),
        `${path}.heightUnderHookM`,
        numericContext,
        "Height under hook",
    );
    validateCatalogueNumber(
        field(crane, "freestandingHeightM"),
        `${path}.freestandingHeightM`,
        numericContext,
        "Freestanding height",
    );

    const dimensions = field(crane, "dimensions");
    if (!isRecord(dimensions)) {
        addError(context, `${path}.dimensions`, "Crane dimensions must be an object.");
    } else {
        validateCatalogueNumber(
            field(dimensions, "mastWidthM"),
            `${path}.dimensions.mastWidthM`,
            numericContext,
            "Mast width",
        );
        validateCatalogueNumber(
            field(dimensions, "baseWidthM"),
            `${path}.dimensions.baseWidthM`,
            numericContext,
            "Base width",
        );
        validateCatalogueNumber(
            field(dimensions, "counterJibLengthM"),
            `${path}.dimensions.counterJibLengthM`,
            numericContext,
            "Counter-jib length",
        );
        validateCatalogueNumber(
            field(dimensions, "counterJibRadiusM"),
            `${path}.dimensions.counterJibRadiusM`,
            numericContext,
            "Counter-jib radius",
        );
    }

    validateHeaviestComponent(
        field(crane, "heaviestErectionComponent"),
        `${path}.heaviestErectionComponent`,
        numericContext,
    );
    validateCombinedPackage(
        field(crane, "combinedTransportPackage"),
        `${path}.combinedTransportPackage`,
        numericContext,
    );

    validateNumericNode(crane, path, numericContext);
}

function collectCraneIds(cranes: readonly unknown[], context: ValidationContext): Set<string> {
    const ids = new Set<string>();
    for (let index = 0; index < cranes.length; index++) {
        const crane = cranes[index];
        if (!isRecord(crane)) continue;

        const id = field(crane, "id");
        if (!isNonEmptyString(id)) continue;

        if (ids.has(id)) {
            addError(context, `cranes[${index}].id`, `Duplicate crane id "${id}".`);
        } else {
            ids.add(id);
        }
    }
    return ids;
}

/**
 * Validate a parsed catalogue. The check is deliberately strict: every numeric
 * value in a crane entry must be a `SourcedNumber` whose provenance is either a
 * defined, documented source with a page, or an explicit INDICATIVE basis.
 */
const MIN_CRANE_COUNT = 4;
const MAX_CRANE_COUNT = 6;
const DEFAULT_CRANE_ID = "potain-mct-88";
const JASO_MODEL_ID = "jaso-j438pa-2r";

export function validateCatalogue(raw: unknown): CatalogueValidationResult {
    const errors: CatalogueValidationIssue[] = [];
    if (!isRecord(raw)) {
        return { ok: false, errors: [{ path: "$", message: "Catalogue must be a JSON object." }] };
    }

    if (field(raw, "schemaVersion") !== 1) {
        errors.push({ path: "schemaVersion", message: "Only catalogue schemaVersion 1 is supported." });
    }

    const cranes = field(raw, "cranes");
    if (!Array.isArray(cranes) || cranes.length === 0) {
        errors.push({ path: "cranes", message: "Catalogue must contain at least one crane." });
        return { ok: false, errors };
    }

    if (cranes.length < MIN_CRANE_COUNT || cranes.length > MAX_CRANE_COUNT) {
        errors.push({
            path: "cranes",
            message: `Catalogue must contain between ${MIN_CRANE_COUNT} and ${MAX_CRANE_COUNT} crane entries.`,
        });
    }

    const defaultCraneId = field(raw, "defaultCraneId");
    if (!isNonEmptyString(defaultCraneId)) {
        errors.push({ path: "defaultCraneId", message: "Catalogue must declare a defaultCraneId." });
    } else if (defaultCraneId !== DEFAULT_CRANE_ID) {
        errors.push({
            path: "defaultCraneId",
            message: `The default crane must be "${DEFAULT_CRANE_ID}".`,
        });
    }

    const firstCrane = cranes[0];
    if (isRecord(firstCrane)) {
        const firstId = field(firstCrane, "id");
        if (firstId !== DEFAULT_CRANE_ID) {
            errors.push({
                path: "cranes[0].id",
                message: `The first catalogue entry must be "${DEFAULT_CRANE_ID}".`,
            });
        }
        if (isNonEmptyString(defaultCraneId) && defaultCraneId !== firstId) {
            errors.push({
                path: "defaultCraneId",
                message: "The default crane must be the first catalogue entry.",
            });
        }
    }

    const context: ValidationContext = { sources: {}, errors };
    collectCraneIds(cranes, context);
    validateModelGrouping(cranes, context);
    cranes.forEach((crane, index) => {
        validateCrane(crane, index, context);
    });

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    return { ok: true, catalogue: raw as unknown as CraneCatalogue, errors: [] };
}
