// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include <emscripten/bind.h>

#include <BRep_Tool.hxx>
#include <GeomAbs_JoinType.hxx>
#include <GeomAbs_Shape.hxx>
#include <GeomPlate_Surface.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_BoundedCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Conic.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_ElementarySurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Hyperbola.hxx>
#include <Geom_Line.hxx>
#include <Geom_OffsetCurve.hxx>
#include <Geom_OffsetSurface.hxx>
#include <Geom_Parabola.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_SweptSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeExtend_CompositeSurface.hxx>
#include <TopoDS.hxx>
#include <TopoDS_CompSolid.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "shared.hpp"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(opencascade)
{
    register_optional<TopoDS_Shape>();

    enum_<GeomAbs_Shape>("GeomAbs_Shape")
        .value("GeomAbs_C0", GeomAbs_C0)
        .value("GeomAbs_C1", GeomAbs_C1)
        .value("GeomAbs_C2", GeomAbs_C2)
        .value("GeomAbs_C3", GeomAbs_C3)
        .value("GeomAbs_CN", GeomAbs_CN)
        .value("GeomAbs_G1", GeomAbs_G1)
        .value("GeomAbs_G2", GeomAbs_G2);

    enum_<GeomAbs_JoinType>("GeomAbs_JoinType")
        .value("GeomAbs_Arc", GeomAbs_Arc)
        .value("GeomAbs_Intersection", GeomAbs_Intersection)
        .value("GeomAbs_Tangent", GeomAbs_Tangent);

    enum_<TopAbs_ShapeEnum>("TopAbs_ShapeEnum")
        .value("TopAbs_VERTEX", TopAbs_VERTEX)
        .value("TopAbs_EDGE", TopAbs_EDGE)
        .value("TopAbs_WIRE", TopAbs_WIRE)
        .value("TopAbs_FACE", TopAbs_FACE)
        .value("TopAbs_SHELL", TopAbs_SHELL)
        .value("TopAbs_SOLID", TopAbs_SOLID)
        .value("TopAbs_COMPOUND", TopAbs_COMPOUND)
        .value("TopAbs_COMPSOLID", TopAbs_COMPSOLID)
        .value("TopAbs_SHAPE", TopAbs_SHAPE);

    enum_<TopAbs_Orientation>("TopAbs_Orientation")
        .value("TopAbs_FORWARD", TopAbs_FORWARD)
        .value("TopAbs_REVERSED", TopAbs_REVERSED)
        .value("TopAbs_INTERNAL", TopAbs_INTERNAL)
        .value("TopAbs_EXTERNAL", TopAbs_EXTERNAL);

    class_<Standard_Transient>("Standard_Transient")
        .function("getRefCount", &Standard_Transient::GetRefCount);

    class_<Geom_Geometry, base<Standard_Transient>>("Geom_Geometry")
        .function("copy", &Geom_Geometry::Copy)
        .function("transform", &Geom_Geometry::Transform)
        .function("transformed", &Geom_Geometry::Transformed);

    class_<Geom_Curve, base<Geom_Geometry>>("Geom_Curve")
        .function("isClosed", &Geom_Curve::IsClosed)
        .function("isPeriodic", &Geom_Curve::IsPeriodic)
        .function("period", &Geom_Curve::Period)
        .function("reverse", &Geom_Curve::Reverse)
        .function("reversed", &Geom_Curve::Reversed)
        .function("d0", &Geom_Curve::D0)
        .function("d1", &Geom_Curve::D1)
        .function("d2", &Geom_Curve::D2)
        .function("d3", &Geom_Curve::D3)
        .function("dn", &Geom_Curve::DN)
        .function("isCN", &Geom_Curve::IsCN)
        .function("firstParameter", &Geom_Curve::FirstParameter)
        .function("lastParameter", &Geom_Curve::LastParameter)
        .function("value", &Geom_Curve::Value)
        .function("continutity", &Geom_Curve::Continuity);

    class_<Geom_Conic, base<Geom_Curve>>("Geom_Conic")
        .function("axis", &Geom_Conic::Axis)
        .function("xAxis", &Geom_Conic::XAxis)
        .function("yAxis", &Geom_Conic::YAxis)
        .function("eccentricity", &Geom_Conic::Eccentricity);

    class_<Geom_Circle, base<Geom_Conic>>("Geom_Circle")
        .function("radius", &Geom_Circle::Radius)
        .function("setRadius", &Geom_Circle::SetRadius)
        .function("location", &Geom_Circle::Location)
        .function("setLocation", &Geom_Circle::SetLocation);

    class_<Geom_Ellipse, base<Geom_Conic>>("Geom_Ellipse")
        .function("majorRadius", &Geom_Ellipse::MajorRadius)
        .function("minorRadius", &Geom_Ellipse::MinorRadius)
        .function("setMajorRadius", &Geom_Ellipse::SetMajorRadius)
        .function("setMinorRadius", &Geom_Ellipse::SetMinorRadius)
        .function("location", &Geom_Ellipse::Location)
        .function("setLocation", &Geom_Ellipse::SetLocation)
        .function("focus1", &Geom_Ellipse::Focus1)
        .function("focus2", &Geom_Ellipse::Focus2);

    class_<Geom_Hyperbola, base<Geom_Conic>>("Geom_Hyperbola")
        .function("majorRadius", &Geom_Hyperbola::MajorRadius)
        .function("minorRadius", &Geom_Hyperbola::MinorRadius)
        .function("setMajorRadius", &Geom_Hyperbola::SetMajorRadius)
        .function("setMinorRadius", &Geom_Hyperbola::SetMinorRadius)
        .function("location", &Geom_Hyperbola::Location)
        .function("setLocation", &Geom_Hyperbola::SetLocation)
        .function("focal", &Geom_Hyperbola::Focal)
        .function("focus1", &Geom_Hyperbola::Focus1)
        .function("focus2", &Geom_Hyperbola::Focus2);

    class_<Geom_Parabola, base<Geom_Conic>>("Geom_Parabola")
        .function("focal", &Geom_Parabola::Focal)
        .function("setFocal", &Geom_Parabola::SetFocal)
        .function("focus", &Geom_Parabola::Focus)
        .function("directrix", &Geom_Parabola::Directrix);

    class_<Geom_BoundedCurve, base<Geom_Curve>>("Geom_BoundedCurve")
        .function("startPoint", &Geom_BoundedCurve::StartPoint)
        .function("endPoint", &Geom_BoundedCurve::EndPoint);

    class_<Geom_Line, base<Geom_Curve>>("Geom_Line")
        .function("position", &Geom_Line::Position)
        .function("setPosition", &Geom_Line::SetPosition)
        .function("setLocation", &Geom_Line::SetLocation)
        .function("setDirection", &Geom_Line::SetDirection);

    class_<Geom_TrimmedCurve, base<Geom_BoundedCurve>>("Geom_TrimmedCurve")
        .function("setTrim", &Geom_TrimmedCurve::SetTrim)
        .function("basisCurve", &Geom_TrimmedCurve::BasisCurve);

    class_<Geom_OffsetCurve, base<Geom_Curve>>("Geom_OffsetCurve")
        .function("offset", &Geom_OffsetCurve::Offset)
        .function("basisCurve", &Geom_OffsetCurve::BasisCurve)
        .function("direction", &Geom_OffsetCurve::Direction);

    class_<Geom_BezierCurve, base<Geom_BoundedCurve>>("Geom_BezierCurve")
        .function("insertPoleAfter",
            select_overload<void(const int, const gp_Pnt&)>(
                &Geom_BezierCurve::InsertPoleAfter))
        .function("insertPoleAfterWithWeight",
            select_overload<void(const int, const gp_Pnt&, const double)>(
                &Geom_BezierCurve::InsertPoleAfter))
        .function("insertPoleBefore",
            select_overload<void(const int, const gp_Pnt&)>(
                &Geom_BezierCurve::InsertPoleBefore))
        .function("insertPoleBeforeWithWeight",
            select_overload<void(const int, const gp_Pnt&, const double)>(
                &Geom_BezierCurve::InsertPoleBefore))
        .function("degree", &Geom_BezierCurve::Degree)
        .function("weight", &Geom_BezierCurve::Weight)
        .function("setWeight", &Geom_BezierCurve::SetWeight)
        .function("nbPoles", &Geom_BezierCurve::NbPoles)
        .function("getPoles", select_overload<const TColgp_Array1OfPnt&() const>(&Geom_BezierCurve::Poles))
        .function("setPoles", select_overload<void(TColgp_Array1OfPnt&) const>(&Geom_BezierCurve::Poles))
        .function("pole", &Geom_BezierCurve::Pole)
        .function("setPole", select_overload<void(int, const gp_Pnt&)>(&Geom_BezierCurve::SetPole))
        .function("setPoleWithWeight",
            select_overload<void(int, const gp_Pnt&, double)>(
                &Geom_BezierCurve::SetPole))
        .function("removePole", &Geom_BezierCurve::RemovePole);

    class_<Geom_BSplineCurve, base<Geom_BoundedCurve>>("Geom_BSplineCurve")
        .function("insertKnot", &Geom_BSplineCurve::InsertKnot)
        .function("degree", &Geom_BSplineCurve::Degree)
        .function("nbPoles", &Geom_BSplineCurve::NbPoles)
        .function("nbKnots", &Geom_BSplineCurve::NbKnots)
        .function("knot", &Geom_BSplineCurve::Knot)
        .function("setKnot", select_overload<void(int, const double)>(&Geom_BSplineCurve::SetKnot))
        .function("weight", &Geom_BSplineCurve::Weight)
        .function("setWeight", &Geom_BSplineCurve::SetWeight)
        .function("getPoles", select_overload<const TColgp_Array1OfPnt&() const>(&Geom_BSplineCurve::Poles))
        .function("setPoles", select_overload<void(TColgp_Array1OfPnt&) const>(&Geom_BSplineCurve::Poles))
        .function("pole", &Geom_BSplineCurve::Pole)
        .function("setPole", select_overload<void(int, const gp_Pnt&)>(&Geom_BSplineCurve::SetPole))
        .function("setPoleWithWeight",
            select_overload<void(int, const gp_Pnt&, double)>(
                &Geom_BSplineCurve::SetPole));

    class_<Geom_Surface, base<Geom_Geometry>>("Geom_Surface")
        .function("continuity", &Geom_Surface::Continuity)
        .function("uIso", &Geom_Surface::UIso)
        .function("vIso", &Geom_Surface::VIso)
        .function("uPeriod", &Geom_Surface::UPeriod)
        .function("vPeriod", &Geom_Surface::VPeriod)
        .function("isUClosed", &Geom_Surface::IsUClosed)
        .function("isVClosed", &Geom_Surface::IsVClosed)
        .function("isUPeriodic", &Geom_Surface::IsUPeriodic)
        .function("isVPeriodic", &Geom_Surface::IsVPeriodic)
        .function("isCNu", &Geom_Surface::IsCNu)
        .function("isCNv", &Geom_Surface::IsCNv)
        .function("d0", &Geom_Surface::D0)
        .function("d1", &Geom_Surface::D1)
        .function("d2", &Geom_Surface::D2)
        .function("d3", &Geom_Surface::D3)
        .function("dn", &Geom_Surface::DN)
        .function("value", &Geom_Surface::Value);

    class_<GeomPlate_Surface, base<Geom_Surface>>("GeomPlate_Surface")
        .function("setBounds", &GeomPlate_Surface::SetBounds);

    class_<Geom_ElementarySurface, base<Geom_Surface>>("Geom_ElementarySurface")
        .function("setAxis", &Geom_ElementarySurface::SetAxis)
        .function("setLocation", &Geom_ElementarySurface::SetLocation)
        .function("axis", &Geom_ElementarySurface::Axis)
        .function("location", &Geom_ElementarySurface::Location)
        .function("position", &Geom_ElementarySurface::Position)
        .function("setPosition", &Geom_ElementarySurface::SetPosition);

    class_<Geom_OffsetSurface, base<Geom_Surface>>("Geom_OffsetSurface")
        .function("offset", &Geom_OffsetSurface::Offset)
        .function("setOffsetValue", &Geom_OffsetSurface::SetOffsetValue)
        .function("basisSurface", &Geom_OffsetSurface::BasisSurface)
        .function("setBasisSurface", &Geom_OffsetSurface::SetBasisSurface);

    class_<Geom_SweptSurface, base<Geom_Surface>>("Geom_SweptSurface")
        .function("basisCurve", &Geom_SweptSurface::BasisCurve)
        .function("direction", &Geom_SweptSurface::Direction);

    class_<ShapeExtend_CompositeSurface, base<Geom_Surface>>(
        "ShapeExtend_CompositeSurface");

    class_<Geom_BSplineSurface, base<Geom_Surface>>("Geom_BSplineSurface");
    class_<Geom_BezierSurface, base<Geom_Surface>>("Geom_BezierSurface");
    class_<Geom_BoundedSurface, base<Geom_Surface>>("Geom_BoundedSurface");
    class_<Geom_RectangularTrimmedSurface, base<Geom_BoundedSurface>>(
        "Geom_RectangularTrimmedSurface")
        .function(
            "setTrim",
            select_overload<void(double, double, double, double, bool, bool)>(
                &Geom_RectangularTrimmedSurface::SetTrim))
        .function("setTrim2", select_overload<void(double, double, bool, bool)>(&Geom_RectangularTrimmedSurface::SetTrim))
        .function("basisSurface", &Geom_RectangularTrimmedSurface::BasisSurface);
    class_<Geom_ConicalSurface, base<Geom_ElementarySurface>>(
        "Geom_ConicalSurface")
        .function("semiAngle", &Geom_ConicalSurface::SemiAngle)
        .function("setSemiAngle", &Geom_ConicalSurface::SetSemiAngle)
        .function("setRadius", &Geom_ConicalSurface::SetRadius)
        .function("apex", &Geom_ConicalSurface::Apex)
        .function("refRadius", &Geom_ConicalSurface::RefRadius);
    class_<Geom_CylindricalSurface, base<Geom_ElementarySurface>>(
        "Geom_CylindricalSurface")
        .function("radius", &Geom_CylindricalSurface::Radius)
        .function("setRadius", &Geom_CylindricalSurface::SetRadius);
    class_<Geom_Plane, base<Geom_ElementarySurface>>("Geom_Plane")
        .function("pln", &Geom_Plane::Pln)
        .function("setPln", &Geom_Plane::SetPln);
    class_<Geom_SphericalSurface, base<Geom_ElementarySurface>>(
        "Geom_SphericalSurface")
        .function("radius", &Geom_SphericalSurface::Radius)
        .function("setRadius", &Geom_SphericalSurface::SetRadius)
        .function("area", &Geom_SphericalSurface::Area)
        .function("volume", &Geom_SphericalSurface::Volume);
    class_<Geom_ToroidalSurface, base<Geom_ElementarySurface>>(
        "Geom_ToroidalSurface")
        .function("majorRadius", &Geom_ToroidalSurface::MajorRadius)
        .function("minorRadius", &Geom_ToroidalSurface::MinorRadius)
        .function("setMajorRadius", &Geom_ToroidalSurface::SetMajorRadius)
        .function("setMinorRadius", &Geom_ToroidalSurface::SetMinorRadius)
        .function("area", &Geom_ToroidalSurface::Area)
        .function("volume", &Geom_ToroidalSurface::Volume);

    class_<Geom_SurfaceOfLinearExtrusion, base<Geom_SweptSurface>>(
        "Geom_SurfaceOfLinearExtrusion")
        .function("direction", &Geom_SurfaceOfLinearExtrusion::Direction)
        .function("setDirection", &Geom_SurfaceOfLinearExtrusion::SetDirection)
        .function("setBasisCurve", &Geom_SurfaceOfLinearExtrusion::SetBasisCurve);
    class_<Geom_SurfaceOfRevolution, base<Geom_SweptSurface>>(
        "Geom_SurfaceOfRevolution")
        .function("location", &Geom_SurfaceOfRevolution::Location)
        .function("setLocation", &Geom_SurfaceOfRevolution::SetLocation)
        .function("setBasisCurve", &Geom_SurfaceOfRevolution::SetBasisCurve)
        .function("direction", &Geom_SurfaceOfRevolution::Direction)
        .function("setDirection", &Geom_SurfaceOfRevolution::SetDirection)
        .function("referencePlane", &Geom_SurfaceOfRevolution::ReferencePlane);

    REGISTER_HANDLE(Standard_Transient);
    REGISTER_HANDLE(Geom_Geometry);
    REGISTER_HANDLE(Geom_Curve);
    REGISTER_HANDLE(Geom_Line);
    REGISTER_HANDLE(Geom_TrimmedCurve);
    REGISTER_HANDLE(Geom_Surface);

    class_<gp_Pnt>("gp_Pnt")
        .constructor<double, double, double>()
        .property("x", &gp_Pnt::X)
        .property("y", &gp_Pnt::Y)
        .property("z", &gp_Pnt::Z);

    class_<gp_Vec>("gp_Vec")
        .constructor<double, double, double>()
        .property("x", &gp_Vec::X)
        .property("y", &gp_Vec::Y)
        .property("z", &gp_Vec::Z);

    class_<gp_Dir>("gp_Dir")
        .constructor<double, double, double>()
        .property("x", &gp_Dir::X)
        .property("y", &gp_Dir::Y)
        .property("z", &gp_Dir::Z);

    class_<gp_Ax1>("gp_Ax1")
        .constructor<const gp_Pnt&, const gp_Dir&>()
        .function("location", &gp_Ax1::Location)
        .function("direction", &gp_Ax1::Direction);

    class_<gp_Ax2>("gp_Ax2")
        .constructor<const gp_Pnt&, const gp_Dir&>()
        .constructor<const gp_Pnt&, const gp_Dir&, const gp_Dir&>()
        .function("location", &gp_Ax2::Location)
        .function("direction", &gp_Ax2::Direction)
        .function("xDirection", &gp_Ax2::XDirection)
        .function("yDirection", &gp_Ax2::YDirection);

    class_<gp_Ax3>("gp_Ax3")
        .constructor<const gp_Pnt&, const gp_Dir&, const gp_Dir&>()
        .constructor<const gp_Ax2&>()
        .function("location", &gp_Ax3::Location)
        .function("direction", &gp_Ax3::Direction)
        .function("xDirection", &gp_Ax3::XDirection)
        .function("yDirection", &gp_Ax3::YDirection)
        .function("direct", &gp_Ax3::Direct);

    class_<gp_Pln>("gp_Pln")
        .constructor<const gp_Ax3&>()
        .constructor<const gp_Pnt&, const gp_Dir&>()
        .function("location", &gp_Pln::Location)
        .function("position", &gp_Pln::Position)
        .function("axis", &gp_Pln::Axis)
        .function("xAxis", &gp_Pln::XAxis)
        .function("yAxis", &gp_Pln::YAxis);

    class_<gp_Trsf>("gp_Trsf")
        .constructor()
        .function("value", &gp_Trsf::Value)
        .function("setValues", &gp_Trsf::SetValues);

    class_<TopLoc_Location>("TopLoc_Location")
        .constructor<const gp_Trsf&>()
        .function("transformation", &TopLoc_Location::Transformation)
        .function("inverted", &TopLoc_Location::Inverted);

    class TopoDSUtils { };
    class_<TopoDSUtils>("TopoDS")
        .class_function(
            "vertex",
            select_overload<TopoDS_Vertex&(TopoDS_Shape&)>(&TopoDS::Vertex),
            return_value_policy::take_ownership())
        .class_function(
            "edge", select_overload<TopoDS_Edge&(TopoDS_Shape&)>(&TopoDS::Edge),
            return_value_policy::take_ownership())
        .class_function(
            "wire", select_overload<TopoDS_Wire&(TopoDS_Shape&)>(&TopoDS::Wire),
            return_value_policy::take_ownership())
        .class_function(
            "face", select_overload<TopoDS_Face&(TopoDS_Shape&)>(&TopoDS::Face),
            return_value_policy::take_ownership())
        .class_function(
            "shell",
            select_overload<TopoDS_Shell&(TopoDS_Shape&)>(&TopoDS::Shell),
            return_value_policy::take_ownership())
        .class_function(
            "solid",
            select_overload<TopoDS_Solid&(TopoDS_Shape&)>(&TopoDS::Solid),
            return_value_policy::take_ownership())
        .class_function(
            "compound",
            select_overload<TopoDS_Compound&(TopoDS_Shape&)>(&TopoDS::Compound),
            return_value_policy::take_ownership())
        .class_function(
            "compsolid",
            select_overload<TopoDS_CompSolid&(TopoDS_Shape&)>(&TopoDS::CompSolid),
            return_value_policy::take_ownership());

    class_<TopoDS_Shape>("TopoDS_Shape")
        .function("infinite",
            select_overload<bool() const>(&TopoDS_Shape::Infinite))
        .function("isEqual", &TopoDS_Shape::IsEqual)
        .function("isNull", &TopoDS_Shape::IsNull)
        .function("isPartner", &TopoDS_Shape::IsPartner)
        .function("isSame", &TopoDS_Shape::IsSame)
        .function("getLocation", select_overload<const TopLoc_Location&() const>(&TopoDS_Shape::Location))
        .function("setLocation",
            select_overload<void(const TopLoc_Location&, bool)>(
                &TopoDS_Shape::Location))
        .function("nbChildren", &TopoDS_Shape::NbChildren)
        .function("nullify", &TopoDS_Shape::Nullify)
        .function("getOrientation", select_overload<TopAbs_Orientation() const>(&TopoDS_Shape::Orientation))
        .function("setOrientation", select_overload<void(TopAbs_Orientation)>(&TopoDS_Shape::Orientation))
        .function("reverse", &TopoDS_Shape::Reverse)
        .function("reversed", &TopoDS_Shape::Reversed)
        .function("shapeType", &TopoDS_Shape::ShapeType)
        .function("located", &TopoDS_Shape::Located)
        .function("move", &TopoDS_Shape::Move)
        .function("moved", &TopoDS_Shape::Moved);

    class_<TColgp_Array1OfPnt>("TColgp_Array1OfPnt")
        .constructor<int, int>()
        .function("value", select_overload<const gp_Pnt&(Standard_Integer) const>(&TColgp_Array1OfPnt::Value))
        .function("setValue",
            select_overload<void(Standard_Integer, const gp_Pnt&)>(
                &TColgp_Array1OfPnt::SetValue))
        .function("length", &TColgp_Array1OfPnt::Length);

    class_<TopoDS_Vertex, base<TopoDS_Shape>>("TopoDS_Vertex");
    class_<TopoDS_Edge, base<TopoDS_Shape>>("TopoDS_Edge");
    class_<TopoDS_Wire, base<TopoDS_Shape>>("TopoDS_Wire");
    class_<TopoDS_Face, base<TopoDS_Shape>>("TopoDS_Face");
    class_<TopoDS_Shell, base<TopoDS_Shape>>("TopoDS_Shell");
    class_<TopoDS_Solid, base<TopoDS_Shape>>("TopoDS_Solid");
    class_<TopoDS_Compound, base<TopoDS_Shape>>("TopoDS_Compound");
    class_<TopoDS_CompSolid, base<TopoDS_Shape>>("TopoDS_CompSolid");
}