// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#pragma once

#include <Geom_Curve.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_SequenceOfShape.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "shared.hpp"

std::vector<ExtremaCCResult> extremaCCs(const Geom_Curve* curve1, const Geom_Curve* curve2, double maxDistance);

std::optional<ProjectPointResult> projectToCurve(const Geom_Curve* curve, gp_Pnt pnt);

ProjectPointResult nearestEnd(const Geom_Curve* curve, gp_Pnt pnt);

ProjectPointResult projectOrNearestCP(const Geom_Curve* curve, const gp_Pnt& pnt);

TopTools_SequenceOfShape shapeArrayToSequenceOfShape(const ShapeArray& shapes);
TopTools_ListOfShape shapeArrayToListOfShape(const ShapeArray& shapes);

double boundingBoxRatio(const TopoDS_Shape& shape, double linearDeflection);