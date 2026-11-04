// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import rawCatalogue from "../data/crane-catalogue.json";
import { validateCatalogue } from "./catalogueValidator";
import type { CraneCatalogue, TowerCrane } from "./types";

const validation = validateCatalogue(rawCatalogue);

if (!validation.ok) {
    const details = validation.errors.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Invalid crane catalogue:\n${details}`);
}

/**
 * The catalogue is static build-time data. Validating it at module load means a
 * missing source cannot reach the capacity engine or the UI: the plugin fails
 * to load instead of quietly presenting an unsourced number.
 */
export const CRANE_CATALOGUE: CraneCatalogue = validation.catalogue;
export const TOWER_CRANES: readonly TowerCrane[] = CRANE_CATALOGUE.cranes;

const MCT88_ID = "potain-mct-88";
const mct88 = TOWER_CRANES.find((crane) => crane.id === MCT88_ID);

if (!mct88) {
    throw new Error(`Crane catalogue is missing the required ${MCT88_ID} entry.`);
}

/** The MCT 88 is the first catalogue entry and the baseline for the ported Cycle 2 tests. */
export const MCT88: TowerCrane = mct88;

const MCT85F5_ID = "potain-mct-85-f5";
const mct85f5 = TOWER_CRANES.find((crane) => crane.id === MCT85F5_ID);

if (!mct85f5) {
    throw new Error(`Crane catalogue is missing the required ${MCT85F5_ID} entry.`);
}

/** The second sourced crane; its capacity comes from the published per-radius chart. */
export const MCT85F5: TowerCrane = mct85f5;

const JASO_TD_ID = "jaso-j438pa-2r-td-213";
const jasoJd = TOWER_CRANES.find((crane) => crane.id === JASO_TD_ID);

if (!jasoJd) {
    throw new Error(`Crane catalogue is missing the required ${JASO_TD_ID} entry.`);
}

/** JASO J438PA.2R, 213 ft jib, TD reeving. Luffing-jib: not evaluated by the trolley engine. */
export const JASO_TD: TowerCrane = jasoJd;

const JASO_2R_ID = "jaso-j438pa-2r-2r-213";
const jaso2r = TOWER_CRANES.find((crane) => crane.id === JASO_2R_ID);

if (!jaso2r) {
    throw new Error(`Crane catalogue is missing the required ${JASO_2R_ID} entry.`);
}

/** JASO J438PA.2R, 213 ft jib, 2R reeving. Luffing-jib: not evaluated by the trolley engine. */
export const JASO_2R: TowerCrane = jaso2r;

export function getCraneById(id: string): TowerCrane | undefined {
    return TOWER_CRANES.find((crane) => crane.id === id);
}
