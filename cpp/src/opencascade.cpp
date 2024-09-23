#include <BRep_Tool.hxx>
#include <emscripten/bind.h>
#include <Geom_TrimmedCurve.hxx>
#include <GeomAbs_JoinType.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_CompSolid.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(opencascade) {

    enum_<GeomAbs_JoinType>("GeomAbs_JoinType")
        .value("GeomAbs_Arc", GeomAbs_Arc)
        .value("GeomAbs_Intersection", GeomAbs_Intersection)
        .value("GeomAbs_Tangent", GeomAbs_Tangent)
    ;

    enum_<TopAbs_ShapeEnum>("TopAbs_ShapeEnum")
        .value("TopAbs_VERTEX", TopAbs_VERTEX)
        .value("TopAbs_EDGE", TopAbs_EDGE)
        .value("TopAbs_WIRE", TopAbs_WIRE)
        .value("TopAbs_FACE", TopAbs_FACE)
        .value("TopAbs_SHELL", TopAbs_SHELL)
        .value("TopAbs_SOLID", TopAbs_SOLID)
        .value("TopAbs_COMPOUND", TopAbs_COMPOUND)
        .value("TopAbs_COMPSOLID", TopAbs_COMPSOLID)
        .value("TopAbs_SHAPE", TopAbs_SHAPE)
    ;


    enum_<TopAbs_Orientation>("TopAbs_Orientation")
        .value("TopAbs_FORWARD", TopAbs_FORWARD)
        .value("TopAbs_REVERSED", TopAbs_REVERSED)
        .value("TopAbs_INTERNAL", TopAbs_INTERNAL)
        .value("TopAbs_EXTERNAL", TopAbs_EXTERNAL)
    ;

    class_<Standard_Transient>("Standard_Transient");
    class_<Geom_Geometry, base<Standard_Transient>>("Geom_Geometry");
    class_<Geom_Curve, base<Geom_Geometry>>("Geom_Curve")
        .function("isClosed", &Geom_Curve::IsClosed)
        .function("isPeriodic", &Geom_Curve::IsPeriodic)
        .function("period", &Geom_Curve::Period)
        .function("reverse", &Geom_Curve::Reverse)
        .function("d1", &Geom_Curve::D1)
        .function("d2", &Geom_Curve::D2)
        .function("d3", &Geom_Curve::D3)
        .function("d4", &Geom_Curve::DN)
        .function("firstParameter", &Geom_Curve::FirstParameter)
        .function("lastParameter", &Geom_Curve::LastParameter)
        .function("value", &Geom_Curve::Value)
    ;
    class_<Geom_TrimmedCurve, base<Geom_Curve>>("Geom_TrimmedCurve");
    class_<Geom_Surface, base<Geom_Geometry>>("Geom_Surface");

    class_<Handle_Geom_Curve>("Handle_Geom_Curve")
        .function("isNull", &Handle_Geom_Curve::IsNull)
        .function("get", &Handle_Geom_Curve::get, allow_raw_pointers())
    ;

    class_<Geom_TrimmedCurve>("Geom_TrimmedCurve")
        .function("isNull", &Handle_Geom_Curve::IsNull)
        .function("get", &Handle_Geom_Curve::get, allow_raw_pointers())
    ;

   class_<gp_Pnt>("gp_Pnt")
        .constructor<double, double, double>()
        .property("x", &gp_Pnt::X)
        .property("y", &gp_Pnt::Y)
        .property("z", &gp_Pnt::Z)
    ;

     class_<gp_Vec>("gp_Vec")
        .constructor<double, double, double>()
        .property("x", &gp_Vec::X)
        .property("y", &gp_Vec::Y)
        .property("z", &gp_Vec::Z)
    ;

    class_<gp_Dir>("gp_Dir")
        .constructor<double, double, double>()
        .property("x", &gp_Dir::X)
        .property("y", &gp_Dir::Y)
        .property("z", &gp_Dir::Z)
    ;

    class_<gp_Ax1>("gp_Ax1")
        .constructor<const gp_Pnt&, const gp_Dir&>()
        .property("location", &gp_Ax1::Location)
        .property("direction", &gp_Ax1::Direction)
    ;

    class_<gp_Ax2>("gp_Ax2")
        .constructor<const gp_Pnt&, const gp_Dir&>()
        .constructor<const gp_Pnt&, const gp_Dir&, const gp_Dir&>()
        .property("location", &gp_Ax2::Location)
        .property("direction", &gp_Ax2::Direction)
        .property("xDirection", &gp_Ax2::XDirection)
        .property("yDirection", &gp_Ax2::YDirection)
    ;

    class_<gp_Ax3>("gp_Ax3")
        .constructor<const gp_Pnt&, const gp_Dir&, const gp_Dir&>()
        .constructor<const gp_Ax2&>()
        .property("location", &gp_Ax3::Location)
        .property("direction", &gp_Ax3::Direction)
        .property("xDirection", &gp_Ax3::XDirection)
        .property("yDirection", &gp_Ax3::YDirection)
        .property("direct", &gp_Ax3::Direct)
    ;

    class_<gp_Trsf>("gp_Trsf")
        .constructor()
        .function("value", &gp_Trsf::Value)
        .function("setValues", &gp_Trsf::SetValues)
    ;

    class_<gp_Pln>("gp_Pln")
        .constructor<const gp_Ax3&>()
        .function("location", &gp_Pln::Location)
        .function("position", &gp_Pln::Position)
    ;

    class_<TopLoc_Location>("TopLoc_Location")
        .constructor<const gp_Trsf&>()
        .function("transformation", &TopLoc_Location::Transformation)
        .function("inverted", &TopLoc_Location::Inverted)
    ;

    class_<TopoDS_Shape>("TopoDS_Shape")
        .function("infinite", select_overload<bool() const>(&TopoDS_Shape::Infinite))
        .function("isEqual", &TopoDS_Shape::IsEqual)
        .function("isNull", &TopoDS_Shape::IsNull)
        .function("isPartner", &TopoDS_Shape::IsPartner)
        .function("isSame", &TopoDS_Shape::IsSame)
        .function("setLocation", select_overload<const TopLoc_Location& () const>(&TopoDS_Shape::Location))
        .function("getLocation", select_overload<void(const TopLoc_Location&, const bool)>(&TopoDS_Shape::Location))
        .function("nbChildren", &TopoDS_Shape::NbChildren)
        .function("nullify", &TopoDS_Shape::Nullify)
        .function("orientation", select_overload<TopAbs_Orientation() const>(&TopoDS_Shape::Orientation))
        .function("reverse", &TopoDS_Shape::Reverse)
        .function("reversed", &TopoDS_Shape::Reversed)
        .function("shapeType", &TopoDS_Shape::ShapeType)
    ;

    class_<TopoDS_Vertex, base<TopoDS_Shape>>("TopoDS_Vertex");
    class_<TopoDS_Edge, base<TopoDS_Shape>>("TopoDS_Edge");
    class_<TopoDS_Wire, base<TopoDS_Shape>>("TopoDS_Wire");
    class_<TopoDS_Face, base<TopoDS_Shape>>("TopoDS_Face");
    class_<TopoDS_Shell, base<TopoDS_Shape>>("TopoDS_Shell");
    class_<TopoDS_Solid, base<TopoDS_Shape>>("TopoDS_Solid");
    class_<TopoDS_Compound, base<TopoDS_Shape>>("TopoDS_Compound");
    class_<TopoDS_CompSolid, base<TopoDS_Shape>>("TopoDS_CompSolid");

    class_<BRep_Tool>("BRep_Tool")
        .class_function("pnt", &BRep_Tool::Pnt)
    ;

}