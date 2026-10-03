// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualStates, VisualStateUtils } from "@chili3d/core";

/**
 * State of a body face the user has picked for a feature — the translucent fill a selection
 * usually gets, plus its boundary outlined, so the faces the feature will act on read apart from
 * the ones that are merely hovered.
 *
 * Shared by every command whose pick is "some faces of this body": the extrude that sweeps them,
 * the thicken that stands material on them, the shell that opens them. They all draw a preview
 * over the body's own faces, which a normal opaque selection would hide.
 */
export const SELECTED_FACE_STATE = VisualStateUtils.addState(
    VisualStates.faceTransparent,
    VisualStates.edgeSelected,
);
