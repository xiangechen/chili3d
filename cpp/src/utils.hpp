// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#pragma once

#include <Geom_Curve.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "shared.hpp"

std::vector<ExtremaCCResult> extremaCCs(const Geom_Curve* curve1,
    const Geom_Curve* curve2,
    double maxDistance);

std::optional<ProjectPointResult> projectToCurve(const Geom_Curve* curve,
    gp_Pnt pnt);

ProjectPointResult nearestEnd(const Geom_Curve* curve, gp_Pnt pnt);

ProjectPointResult projectOrNearestCP(const Geom_Curve* curve,
    const gp_Pnt& pnt);

double boundingBoxRatio(const TopoDS_Shape& shape, double linearDeflection);