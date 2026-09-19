// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The pure algebra of tracked sub-shape ids — composing compounds and comparing
 * them. Kept dependency-free and separate from `feature.ts` (which owns the
 * history/registry machinery built on it) because the ref-matching layer
 * (`edgeRef.ts`) needs `idsOverlap` too, and importing it from `feature.ts` would
 * close the `edgeRef -> feature -> edgeRef` cycle.
 */

/** Separator between the components of a compound tracked id (see `combineIds`). */
export const ID_COMPONENT_SEPARATOR = "|";

/**
 * Marker of a POSITIONAL id — the id a generated sub-shape takes when the kernel's
 * history could not attribute it to anything (`{featureId}@{outputIndex}`).
 *
 * - **Why it is marked.** A positional id names "the n-th output of feature F", not a
 *   piece of geometry: the kernel is free to re-enumerate a rebuilt shape, and the id
 *   then silently names a NEIGHBOUR (see `profileSeeds.ts` on why seeds are
 *   content-derived). Attribute every generated sub-shape you can; what still falls
 *   back is flagged so the matching layer can weigh it as the weak hint it is
 *   (`edgeMatcher` distrusts one that contradicts a decisive geometric match).
 * - **Why `@`.** `Id.generate`'s alphabet is `A-Za-z0-9_-`, so no node, feature or
 *   seed id can contain it — the marker is unambiguous, unlike `:`, which every id
 *   component uses.
 * - **Documents written before the marker existed** (`f1:5`) simply stop matching: the ref
 *   falls back to its geometric fingerprint, and the first successful rebuild re-anchors it
 *   with the marked id (`refreshAnchoredRefs`). A re-opened document can therefore meet an
 *   AMBIGUOUS fingerprint once, on a body whose geometry is genuinely ambiguous; there is no
 *   migration step, and none is needed for the common case.
 */
const POSITIONAL_MARKER = "@";

/** The feature-scoped id of an output the kernel's history did not attribute. */
export function positionalId(featureId: string, outputIndex: number): string {
    return `${featureId}${POSITIONAL_MARKER}${outputIndex}`;
}

/** True when `id` is (or contains) a positional id — a weak, enumeration-scoped hint. */
export function isPositionalId(id: string): boolean {
    return id.split(ID_COMPONENT_SEPARATOR).some((leaf) => leaf.includes(POSITIONAL_MARKER));
}

/**
 * `id` with `suffix` hung off EVERY leaf — the only safe way to derive an id from a stem
 * that may already be a compound. Suffixing the whole string would leave the later leaves
 * bare, and they would then collide with the ids that live in the host's own id space
 * (the same trap `mapBooleanIds` documents for its tool prefix).
 *
 * **The suffix must be atomic** — use `embeddedId` for anything that may itself be a
 * compound, or the same leak happens through the back door.
 */
export function derivedId(id: string, suffix: string): string {
    return id
        .split(ID_COMPONENT_SEPARATOR)
        .map((leaf) => `${leaf}${suffix}`)
        .join(ID_COMPONENT_SEPARATOR);
}

/**
 * `id` flattened into ONE component, for embedding inside another id.
 *
 * An embedded id keeps its identity only as a whole: leaving it compound would leak its
 * leaves into the host's id space, where `idsOverlap` compares component-wise — measured,
 * two fillet seams on different corners of a boolean-merged face then shared a bare face
 * component and reported as overlapping, so a ref on one could swallow the other.
 *
 * `^` does the escaping because it is the one character no other part of the grammar claims:
 * `|` separates components, `@` marks positional ids, `~` the duplicate-entity-set occurrence
 * suffix (`profileSeeds`), `:` and `.` the seed parts.
 */
export function embeddedId(id: string): string {
    return id.split(ID_COMPONENT_SEPARATOR).join("^");
}

/**
 * One ATOMIC name for the boundary between several sub-shapes — the pair of faces an edge
 * joins, the face side a corner's edge borders.
 *
 * A conjunction, not a merge, and that is why it is atomic rather than a `combineIds`
 * compound: `A&B` says "the edge between A and B", while `A|B` says "derived from A and B".
 * `idsOverlap` compares components, so a compound would make every boundary sharing a face
 * look like the same sub-shape — measured, a bore's four curves all touch the top face, and a
 * fillet on one would have swallowed the rest. `embeddedId` keeps a compound name inside.
 */
export function boundaryId(ids: readonly string[]): string {
    return [...new Set(ids)].sort().map(embeddedId).join("&");
}

/**
 * Combines the ids of every input sub-shape an output sub-shape derives from into one
 * stable id. A single ancestor keeps its id unchanged (bit-for-bit the pre-compound
 * behavior); several ancestors — a boolean MERGED their sub-shapes into one — form a
 * sorted, flattened, deduped compound, so a later piece of the merge or a re-merge of
 * the pieces still intersects it (`idsOverlap`). Flattening keeps the genealogy a set
 * of leaf ids: a merged face merging again contributes its components, not its string.
 */
export function combineIds(ids: readonly string[]): string {
    const components = new Set(ids.flatMap((id) => id.split(ID_COMPONENT_SEPARATOR)));
    return [...components].sort().join(ID_COMPONENT_SEPARATOR);
}

/**
 * True when two tracked ids share at least one component — i.e. one's genealogy set
 * intersects the other's (a piece of a split merge, or a face that merged further).
 */
export function idsOverlap(a: string, b: string): boolean {
    const components = new Set(a.split(ID_COMPONENT_SEPARATOR));
    return b.split(ID_COMPONENT_SEPARATOR).some((x) => components.has(x));
}

/**
 * Per-output lists of input sub-shape indexes: seeded from the single-valued `map`,
 * extended with the kernel's full derivation pairs when present (`faceAncestors`,
 * booleans). An output MERGED from several inputs ends up with all of them.
 */
export function ancestorInputs(map: readonly number[], ancestors?: readonly number[]): number[][] {
    const perOutput: number[][] = map.map((inputIndex) => (inputIndex < 0 ? [] : [inputIndex]));
    if (ancestors === undefined) return perOutput;
    for (let i = 0; i + 1 < ancestors.length; i += 2) {
        const [output, input] = [ancestors[i], ancestors[i + 1]];
        if (output >= 0 && output < perOutput.length && !perOutput[output].includes(input)) {
            perOutput[output].push(input);
        }
    }
    return perOutput;
}

/**
 * The shared tail of `mapBooleanIds`/`mapOperationIds`: every output's ancestor
 * input indexes (`ancestorInputs`) are mapped through `idOfInput` and combined —
 * an output with no ancestors takes `bornId`, or a positional id when the caller
 * cannot name it by content, and one derived from several inputs (a boolean merge)
 * combines every ancestor's id (`combineIds`), so pieces of a later re-split still
 * intersect the stored id.
 */
export function mapAncestorIds(
    featureId: string,
    map: readonly number[],
    ancestors: readonly number[] | undefined,
    idOfInput: (inputIndex: number, outputIndex: number) => string,
    bornId?: (outputIndex: number) => string | undefined,
): string[] {
    const perOutput = ancestorInputs(map, ancestors);
    return map.map((_, outputIndex) => {
        const inputs = perOutput[outputIndex];
        if (inputs.length === 0) {
            // An output nothing in the kernel's history derives from (a boolean's
            // intersection curve). Callers that can identify it by content supply
            // `bornId`; the positional fallback stays for the rest.
            return bornId?.(outputIndex) ?? positionalId(featureId, outputIndex);
        }
        return combineIds(inputs.map((x) => idOfInput(x, outputIndex)));
    });
}

/**
 * The candidates whose id no sibling also computes — the guard every attribution path applies
 * before writing an id it derived.
 *
 * An id two sub-shapes could both claim would make the matcher read them as pieces of one
 * (`idsOverlap`), so a contested id is dropped and those sub-shapes keep their positional ids
 * instead. The check is component-wise, not textual, because that is how the matcher compares:
 * two compound ids can overlap without being equal, and two equal ids always overlap.
 */
export function uncontested(candidates: ReadonlyMap<number, string>): Map<number, string> {
    const entries = [...candidates];
    return new Map(
        entries.filter(([, id]) => entries.every(([, other]) => other === id || !idsOverlap(id, other))),
    );
}

/**
 * True when the id overlaps more than one entry — pieces of a split sub-shape.
 * Overlap is component-wise (`idsOverlap`), not textual: a piece that merged with a
 * collinear neighbor carries a compound like `A|B` while its untouched sibling keeps
 * `A`, and both pieces are the same logical split edge. Exact duplicates — the only
 * case a textual comparison sees — are a subset of this.
 */
export function idIsShared(ids: readonly string[], id: string | undefined): boolean {
    return id !== undefined && indexesOfOverlappingId(ids, id).length > 1;
}

/**
 * Indexes of every id overlapping `id` (`idsOverlap`) — the shared scan behind
 * `IBodyTrackingNode.faceIndexesOfId`/`edgeIndexesOfId`, the sketch external-ref
 * stand-in lookup and the press-pull face matching. An undefined entry (tracking
 * lapsed for that sub-shape) never matches.
 */
export function indexesOfOverlappingId(ids: readonly (string | undefined)[], id: string): number[] {
    const indexes: number[] = [];
    for (let i = 0; i < ids.length; i++) {
        const value = ids[i];
        if (value !== undefined && idsOverlap(value, id)) indexes.push(i);
    }
    return indexes;
}
