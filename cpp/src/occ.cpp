#include <emscripten/bind.h>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_CompSolid.hxx>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(opencascade) {

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

    class_<TopoDS_Shape>("TopoDS_Shape")
        .function("isNull", &TopoDS_Shape::IsNull);
    class_<TopoDS_Vertex, base<TopoDS_Shape>>("TopoDS_Vertex");
    class_<TopoDS_Edge, base<TopoDS_Shape>>("TopoDS_Edge");
    class_<TopoDS_Wire, base<TopoDS_Shape>>("TopoDS_Wire");
    class_<TopoDS_Face, base<TopoDS_Shape>>("TopoDS_Face");
    class_<TopoDS_Shell, base<TopoDS_Shape>>("TopoDS_Shell");
    class_<TopoDS_Solid, base<TopoDS_Shape>>("TopoDS_Solid");
    class_<TopoDS_Compound, base<TopoDS_Shape>>("TopoDS_Compound");
    class_<TopoDS_CompSolid, base<TopoDS_Shape>>("TopoDS_CompSolid");

}