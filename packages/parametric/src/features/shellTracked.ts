// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IFace,
    type IShape,
    type JoinType,
    Result,
    ShapeTypes,
    type TrackedShape,
} from "@chili3d/core";
import { type CompletedTrackedHistory, completeTrackedHistory, trackedFaceIds, trackedIds } from "./feature";
import { bornEdgeIdMap } from "./operationIds";
import { ancestorInputs, boundaryId, derivedId, prefixedId, writeUncontestedIds } from "./trackedId";

/**
 * The tracked counterpart of `makeThickSolidByJoin`, i.e. of Onshape's Shell: the whole chain
 * input is hollowed to a wall thickness, with the faces the user opened left off, and every
 * sub-shape it builds is named from the input it came from.
 *
 * **What the kernel reports, measured on a 40×40×20 box with the top (input face 5) open and
 * a −2 wall** (the whole design follows from these three facts):
 *
 * 1. The derivation pairs name BOTH faces a kept face produced: `in0 → out0, out6` — the outer
 *    wall and its inner copy — and the SAME for the opened face: `in5 → out5`, where out5 is the
 *    **rim** (the 40²−36² border band the opening leaves), not a copy of the top face.
 * 2. The kernel's `offsetFaceMap` therefore carries exactly one spurious entry for a shell: the
 *    opened face's. It is dropped in C++ (`offsetHistory`'s `removed` set skips the closing
 *    faces), because a removed face has no parallel copy and the channel's contract says it
 *    reports one. Nothing is lost — the rim is still claimed by the pairs, which this module
 *    reads first.
 * 3. The kernel's `offsetEdgeMap` names only the edges offset FACE-PARALLEL (4 of the 12 inner
 *    edges here, at |t| from their generator); under an `intersection` join it names all 12, the
 *    rest being at |t|·√2 because two adjacent faces move at once. So an edge's id must NOT be
 *    keyed off that channel first — it would depend on `joinType`, a styling parameter, and
 *    toggling it would strand every reference on those edges. The inner edges are named by the
 *    two faces they join instead (`nameEdges`), which reads the same under either join.
 *
 * **What stays unnamed**: an outward shell under an `arc` join raises fillet bands at the outer
 * corners, and where three of them meet it leaves a sphere patch at an input VERTEX — a sub-shape
 * no derivation reports, and whose boundary edges have an unnamed patch on one side, so no face
 * pair names them either. Measured on an outward box: 4 such patches and their 12 boundary edges.
 * Leaving them id-less is the documented degradation, not a special case (`trackedIds` in
 * feature.ts): the matching layer resolves them geometrically.
 */

/**
 * The component of a shell sub-shape name that marks it as raised at the opening — the
 * counterpart of the thicken's `THICKEN_MARKER`. The opened face's own id lives in the body's
 * id space too, so a rim named after it alone would be read as the face the user deleted.
 */
const SHELL_MARKER = "shell";

/** The kernel input: the chain's shape, the faces to open (its own sub-shapes), plus their ids. */
export interface ShellInput {
    /** The body's chain input — what gets hollowed. */
    readonly shape: IShape;
    /**
     * The faces to open, as ACTUAL sub-shapes of `shape` (same TShape): the kernel matches them
     * by `IsSame`, so a transformed copy from another frame would silently open nothing.
     */
    readonly openFaces: readonly IFace[];
    /** `openFaces`' indexes in `shape.findSubShapes(face)` order — the kernel's own numbering. */
    readonly openFaceIndexes: readonly number[];
    /** Tracked ids of `shape`'s faces, in its `findSubShapes` order. */
    readonly faceIds: readonly (string | undefined)[];
    /** Tracked ids of `shape`'s edges, in its `findSubShapes` order. */
    readonly edgeIds: readonly (string | undefined)[];
}

/** A shell result with the stable ids of every sub-shape it built, in findSubShapes order. */
export interface ShellIds {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Hollows `input.shape` to `signedThickness`, naming every sub-shape the kernel builds.
 * `signedThickness` is negative inward and positive outward (the kernel's convention,
 * measured both ways).
 *
 * Returns `undefined` when the kernel offers no tracked shell — the caller then takes the plain
 * path, which builds the same geometry with no ids at all. `featureId` scopes the names minted
 * for sub-shapes no input produced, so two shells in one chain cannot compute the same one.
 */
export function shellTracked(
    input: ShellInput,
    signedThickness: number,
    joinType: JoinType,
    featureId: string,
): Result<ShellIds> | undefined {
    if (shapeFactory.makeThickSolidByJoinTracked === undefined) return undefined;
    const result = shapeFactory.makeThickSolidByJoinTracked(
        input.shape,
        [...input.openFaces],
        signedThickness,
        joinType,
    );
    if (!result.isOk) return Result.err(result.error);

    const tracked: TrackedShape = result.value;
    const completed = completeTrackedHistory([input.shape], tracked, {
        inputFaces: input.shape.findSubShapes(ShapeTypes.face) as IFace[],
        inputEdges: input.shape.findSubShapes(ShapeTypes.edge) as IEdge[],
    });
    const open = new Set(input.openFaceIndexes);
    const faceIds = nameFaces(input, tracked, completed, open);
    const edgeIds = nameEdges(input, tracked, completed, faceIds, featureId);
    return Result.ok({ shape: tracked.shape, faceIds, edgeIds });
}

/**
 * Names every output face, in the order the kinds become nameable:
 * - **kept face** — inherits the input face's id (`trackedFaceIds`).
 * - **corner band** — an `arc` join raises a band along the input EDGE the wall turns on, which
 *   the kernel reports through its edge-derived channel; it takes that edge's id. Only an
 *   outward shell produces them (measured: an outward box has 8 of them, an inward one none).
 * - **offset face** — `<source id>:offset`, from the kernel's offset channel. Its entries for
 *   the OPENED faces are dropped: the C++ side already skips them (see the module doc), and the
 *   guard here keeps the rule true against a stale binary.
 * - **rim** — the band an opening leaves. Its ancestor IS the opened face, but the face itself is
 *   gone, so inheriting that id would let a reference to the deleted face quietly resolve onto a
 *   wall-thickness band. It gets `shell&<opened face id>` instead: content-derived, atomic, and
 *   distinct from both the opened face's id and its would-be `:offset`.
 */
function nameFaces(
    input: ShellInput,
    tracked: TrackedShape,
    completed: CompletedTrackedHistory,
    open: ReadonlySet<number>,
): (string | undefined)[] {
    const faceIds = trackedFaceIds(input.faceIds, input.edgeIds, completed.faceMap, tracked.faceEdgeMap);
    (tracked.offsetFaceMap ?? []).forEach((inputIndex, outputIndex) => {
        const id = input.faceIds[inputIndex];
        if (inputIndex < 0 || open.has(inputIndex) || id === undefined || outputIndex >= faceIds.length) {
            return;
        }
        faceIds[outputIndex] = derivedId(id, ":offset");
    });
    attributeRimFaces(faceIds, input, tracked, completed, open);
    return faceIds;
}

/**
 * Names the rim bands — the outputs the opened faces derive into.
 *
 * Reads the DERIVATION ancestors, not geometry: unlike a thicken's rim (which the kernel reports
 * nothing for, so `thickenTracked` has to find the boundary edge each band stands on), a shell's
 * rim is reported from the face that was removed. A band generated by several connected openings
 * carries all of them, so the name lists them together — `boundaryId` is a conjunction, and a
 * rim standing over two openings IS their shared border.
 */
function attributeRimFaces(
    faceIds: (string | undefined)[],
    input: ShellInput,
    tracked: TrackedShape,
    completed: CompletedTrackedHistory,
    open: ReadonlySet<number>,
): void {
    const ancestors = ancestorInputs(completed.faceMap, tracked.faceAncestors);
    const candidates = new Map<number, string>();
    completed.outputFaces.forEach((_, outputIndex) => {
        const opened = ancestors[outputIndex].filter((index) => open.has(index));
        if (opened.length === 0) return;
        const ids = opened
            .map((index) => input.faceIds[index])
            .filter((id): id is string => id !== undefined);
        if (ids.length === 0) return;
        // The id the face inherited through the derivation channel names the face that is GONE
        // from this shape; drop it before claiming the band.
        faceIds[outputIndex] = undefined;
        candidates.set(outputIndex, boundaryId([SHELL_MARKER, ...ids]));
    });
    writeUncontestedIds(faceIds, candidates);
}

/**
 * Names every output edge, in the order the two kinds become nameable:
 * - **inherited** — the derivation pairs give it an input edge's id (`trackedIds`).
 * - **born** — whatever is left takes the two faces it joins (`bornEdgeIdMap`).
 *
 * The kernel's `offsetEdgeMap` is deliberately not consulted, even for what the face pair cannot
 * reach. It names an inner edge as a copy of the input edge it was offset from, and it fires
 * differently per `joinType` (measured: on the inward box it names 4 of the 12 inner edges under
 * `arc` and all 12 under `intersection`), so an id keyed off it would move when the user toggles a
 * styling parameter — and where the face pair fails, so does it (measured: the outward box's
 * patch boundaries are in neither channel).
 */
function nameEdges(
    input: ShellInput,
    tracked: TrackedShape,
    completed: CompletedTrackedHistory,
    faceIds: readonly (string | undefined)[],
    featureId: string,
): (string | undefined)[] {
    const edgeIds = trackedIds(input.edgeIds, completed.edgeMap);
    const born = bornEdgeIdMap(
        tracked.shape,
        completed.outputEdges,
        completed.outputFaces,
        faceIds,
        // Still unnamed: the derivation has already named the edges it inherited.
        (index) => completed.edgeMap[index] < 0 && edgeIds[index] === undefined,
    );
    writeUncontestedIds(edgeIds, new Map([...born].map(([index, id]) => [index, prefixedId(featureId, id)])));
    return edgeIds;
}
