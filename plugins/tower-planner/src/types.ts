// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Where a catalogue number came from. A source must name the document and page
 * so the value can be checked; `indicative` is the explicit alternative for a
 * project assumption that is not a manufacturer figure.
 */
export type SourceDocument = {
    document: string;
    page: number;
    section?: string;
    url?: string;
    note?: string;
};

export type SourceProvenance = {
    kind: "source";
    sourceId: string;
};

export type IndicativeProvenance = {
    kind: "indicative";
    basis: string;
};

export type FieldProvenance = SourceProvenance | IndicativeProvenance;

/**
 * Every number in a crane entry is wrapped in this type. The validator rejects
 * a bare number, so a missing source cannot be hidden by a partial edit.
 */
export type SourcedNumber = {
    value: number;
    provenance: FieldProvenance;
};

export type TipLoadRow = {
    jibM: SourcedNumber;
    tipT: SourcedNumber;
};

/**
 * One point on a manufacturer's per-radius load chart. Unlike the Cycle 2
 * tip-load table, these points are read directly from the published curve and
 * are not derived from a moment formula.
 */
export type LoadChartPoint = {
    radiusM: SourcedNumber;
    capacityT: SourcedNumber;
};

/**
 * The published load chart for one jib configuration. The chart is only valid
 * for the exact jib length it was published for; the capacity engine does not
 * invent a chart for an unlisted jib.
 */
export type JibLoadChart = {
    jibM: SourcedNumber;
    /**
     * Smallest hook radius the manufacturer publishes for this jib. The chart
     * rows store the end of the flat maximum-capacity plateau as their first
     * point, so this value is kept separately rather than inferred from
     * `points[0]`. A radius below it has no published capacity.
     */
    minRadiusM: SourcedNumber;
    points: readonly LoadChartPoint[];
};

export type CraneDimensions = {
    mastWidthM: SourcedNumber;
    counterJibLengthM: SourcedNumber;
};

export type HeaviestErectionComponent = {
    name: string;
    massT: SourcedNumber;
    note?: string;
};

/**
 * The part of a catalogue entry the capacity and pick engines need. Keeping
 * this narrower than `TowerCrane` lets tests use a clearly synthetic crane
 * without inventing catalogue metadata for a real machine.
 */
export type CapacityModel = {
    id: string;
    name: string;
    maxCapacityT: SourcedNumber;
    defaultJibM: SourcedNumber;
    tipLoadByJib: readonly TipLoadRow[];
    /**
     * Optional manufacturer per-radius chart. When present, `capacityAt` uses
     * the chart for the exact published jib configurations and does not apply
     * the Cycle 2 tip-load idealisation. Cranes without this field keep the
     * Cycle 2 behaviour.
     */
    loadChart?: readonly JibLoadChart[];
};

export type TowerCrane = CapacityModel & {
    standard: string;
    sources: Record<string, SourceDocument>;
    maxJibLengthM: SourcedNumber;
    dimensions: CraneDimensions;
    heaviestErectionComponent: HeaviestErectionComponent;
};

export type CraneCatalogue = {
    schemaVersion: number;
    cranes: TowerCrane[];
};