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
 * `id` namespaced under `prefix` — EVERY leaf prefixed, the mirror of `derivedId`. Prefixing the
 * whole string instead would leave the later leaves bare, to collide with the ids already in the
 * host's own id space (`mapBooleanIds`'s `tool:` prefix is the same rule written by hand).
 *
 * The prefix is what makes a name say WHO built the sub-shape, not just what it was built from:
 * two operations deriving names from the same input — two corners on the two pieces of one split
 * edge — would otherwise compute identical ids, and one of them would have to go unnamed.
 */
export function prefixedId(prefix: string, id: string): string {
    return id
        .split(ID_COMPONENT_SEPARATOR)
        .map((leaf) => `${prefix}:${leaf}`)
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
 * `|` separates components, `~` the duplicate-entity-set occurrence suffix (`profileSeeds`),
 * `:` and `.` the seed parts.
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
 * The shared tail of `mapBooleanIds`/`mapOperationIds`/`mapFusedIds`: every output's
 * ancestor input indexes (`ancestorInputs`) are mapped through `idOfInput` and combined —
 * an output with no ancestors takes `bornId`, and one derived from several inputs (a
 * boolean merge) combines every ancestor's id (`combineIds`), so pieces of a later
 * re-split still intersect the stored id.
 *
 * An output nothing can name — no ancestor, or ancestors that are themselves unattributed —
 * gets NO id. That is deliberate: naming it by where it sits in the kernel's enumeration
 * would be a name a rebuilt body is free to hand to a neighbour (see `trackedIds` in
 * feature.ts). An id-less sub-shape is resolved geometrically instead.
 */
export function mapAncestorIds(
    map: readonly number[],
    ancestors: readonly number[] | undefined,
    idOfInput: (inputIndex: number) => string | undefined,
    bornId?: (outputIndex: number) => string | undefined,
): (string | undefined)[] {
    const perOutput = ancestorInputs(map, ancestors);
    return map.map((_, outputIndex) => {
        const inputs = perOutput[outputIndex];
        if (inputs.length === 0) return bornId?.(outputIndex);
        const ids = inputs.map((x) => idOfInput(x)).filter((x): x is string => x !== undefined);
        return ids.length === 0 ? undefined : combineIds(ids);
    });
}

/**
 * The candidates whose id no sibling also computes — the guard every attribution path applies
 * before writing an id it derived.
 *
 * An id two sub-shapes could both claim would make the matcher read them as pieces of one
 * (`idsOverlap`), so a contested id is dropped and those sub-shapes stay unnamed instead. The check is component-wise, not textual, because that is how the matcher compares:
 * two compound ids can overlap without being equal, and two equal ids always overlap.
 */
export function uncontested(candidates: ReadonlyMap<number, string>): Map<number, string> {
    const entries = [...candidates];
    return new Map(
        // Self is skipped by POSITION, not by value: `other === id` would also excuse an equal
        // sibling, and two sub-shapes computing the same id is the most contested case there is.
        entries.filter(([, id], index) =>
            entries.every(([, other], otherIndex) => otherIndex === index || !idsOverlap(id, other)),
        ),
    );
}

/**
 * Write the candidates that are safe to take into `ids`, and return the indexes written.
 *
 * The module's invariant, enforced where a name is minted rather than argued away: a name belongs
 * to ONE sub-shape, or the matcher reads two as pieces of one. Two things can stand in a
 * candidate's way — the other candidates (a mirrored or duplicated profile offers one seed twice,
 * and only one of the two may take it), and a name `ids` already carries, which is not a sibling
 * candidate at all but the input's own inherited ids. `uncontested` settles the first and cannot
 * see the second, so it is called here rather than left to the caller. Both are compared
 * component-wise (`idsOverlap`), the way the matcher compares.
 *
 * The indexes come back for callers with something to record alongside the name they took.
 */
export function writeUncontestedIds(
    ids: (string | undefined)[],
    candidates: ReadonlyMap<number, string>,
): number[] {
    const identities = ids.filter((id): id is string => id !== undefined);
    const written: number[] = [];
    for (const [index, id] of uncontested(candidates)) {
        if (identities.some((taken) => idsOverlap(taken, id))) continue;
        ids[index] = id;
        written.push(index);
    }
    return written;
}

/**
 * True when the id overlaps more than one entry — pieces of a split sub-shape.
 * Overlap is component-wise (`idsOverlap`), not textual: a piece that merged with a
 * collinear neighbor carries a compound like `A|B` while its untouched sibling keeps
 * `A`, and both pieces are the same logical split edge. Exact duplicates — the only
 * case a textual comparison sees — are a subset of this.
 */
export function idIsShared(ids: readonly (string | undefined)[], id: string | undefined): boolean {
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
