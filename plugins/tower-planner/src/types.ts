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

/**
 * A catalogue field the inspected documents genuinely do not state. This is
 * deliberately distinct from a zero, a blank or a guessed value: the reason is
 * mandatory so the UI and the validator can explain the absence.
 */
export type NotStated = {
    kind: "notStated";
    reason: string;
};

/** A catalogue number that may be explicitly undocumented. */
export type CatalogueNumber = SourcedNumber | NotStated;

/** The jib/reeving family. Luffing-jib geometry is not modelled by this engine. */
export type CraneType = "trolley-jib" | "luffing-jib";

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
    mastWidthM: CatalogueNumber;
    /** Foundation/base width, distinct from the mast section width. */
    baseWidthM: CatalogueNumber;
    /** Counter-jib structural length (the p. 6 table's L), not its radius. */
    counterJibLengthM: CatalogueNumber;
    /** Counter-jib radius from the slewing centre, distinct from its structural length. */
    counterJibRadiusM: CatalogueNumber;
};

export type HeaviestErectionComponent =
    | {
          name: string;
          massT: SourcedNumber;
          note?: string;
      }
    | NotStated;

/**
 * A combined transport package. It is recorded separately because a packing
 * list line is not evidence of an individual erection component or of the
 * heaviest erection lift.
 */
export type CombinedTransportPackage = {
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
    /**
     * Optional on the narrow engine type so clearly synthetic test fixtures can
     * omit it. A catalogue entry always declares it. `capacityAt` refuses to
     * evaluate a luffing-jib model with the trolley-jib capacity rules.
     */
    craneType?: CraneType;
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
    /**
     * Published maximum working jib. Required on a `TowerCrane` and optional on
     * this narrower engine type so clearly synthetic test fixtures can omit it;
     * when absent, the longest load-chart row or the last tip-load row is the
     * data limit. `capacityAt` never treats a jib above this limit as valid.
     */
    maxJibLengthM?: SourcedNumber;
};

export type TowerCrane = CapacityModel & {
    craneType: CraneType;
    /** Groups configurations of one physical model; `id` identifies the entry. */
    modelId: string;
    modelName: string;
    /** Configuration label within `modelId`, e.g. "213 ft TD". */
    configuration: string;
    standard: string;
    sources: Record<string, SourceDocument>;
    maxJibLengthM: SourcedNumber;
    /**
     * Manufacturer's height under hook. This is not a freestanding-height
     * limit; that is stored separately in `freestandingHeightM`.
     */
    heightUnderHookM: CatalogueNumber;
    freestandingHeightM: CatalogueNumber;
    dimensions: CraneDimensions;
    heaviestErectionComponent: HeaviestErectionComponent;
    /** Packing-list mass for a combined package, not an erection component. */
    combinedTransportPackage?: CombinedTransportPackage;
};

export type CraneCatalogue = {
    schemaVersion: number;
    /** Must name the first entry; the MCT 88 is the default catalogue crane. */
    defaultCraneId: string;
    cranes: TowerCrane[];
};
