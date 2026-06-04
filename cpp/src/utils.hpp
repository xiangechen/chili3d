// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#pragma once

#include <Geom_Curve.hxx>
#include <NCollection_Map.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "shared.hpp"

std::vector<ExtremaCCResult> extremaCCs(const Geom_Curve* curve1, const Geom_Curve* curve2, double maxDistance);

std::optional<ProjectPointResult> projectToCurve(const Geom_Curve* curve, gp_Pnt pnt);

ProjectPointResult nearestEnd(const Geom_Curve* curve, gp_Pnt pnt);

ProjectPointResult projectOrNearestCP(const Geom_Curve* curve, const gp_Pnt& pnt);

NCollection_Sequence<TopoDS_Shape> shapeArrayToSequenceOfShape(const ShapeArray& shapes);
NCollection_List<TopoDS_Shape> shapeArrayToListOfShape(const ShapeArray& shapes);
NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> shapeArrayToMapOfShape(const ShapeArray& shapes);

double boundingBoxRatio(const TopoDS_Shape& shape, double linearDeflection, bool useTriangulation);
std::optional<gp_Pnt2d> pointToFaceUV(const TopoDS_Face& face, gp_Pnt pnt, double tolerance);