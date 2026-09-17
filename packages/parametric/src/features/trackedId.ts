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
 * an output with no ancestors takes a stable feature-scoped id, and one derived
 * from several inputs (a boolean merge) combines every ancestor's id
 * (`combineIds`), so pieces of a later re-split still intersect the stored id.
 */
export function mapAncestorIds(
    featureId: string,
    map: readonly number[],
    ancestors: readonly number[] | undefined,
    idOfInput: (inputIndex: number, outputIndex: number) => string,
): string[] {
    const perOutput = ancestorInputs(map, ancestors);
    return map.map((_, outputIndex) => {
        const inputs = perOutput[outputIndex];
        if (inputs.length === 0) return `${featureId}:${outputIndex}`;
        return combineIds(inputs.map((x) => idOfInput(x, outputIndex)));
    });
}
