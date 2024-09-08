#include <emscripten/bind.h>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(opencascade) {

   class_<gp_Pnt>("Point3")
        .constructor<double, double, double>()
        .property("x", &gp_Pnt::X)
        .property("y", &gp_Pnt::Y)
        .property("z", &gp_Pnt::Z)
    ;

     class_<gp_Vec>("Vector3")
        .constructor<double, double, double>()
        .property("x", &gp_Vec::X)
        .property("y", &gp_Vec::Y)
        .property("z", &gp_Vec::Z)
    ;

    class_<gp_Dir>("UnitVector3")
        .constructor<double, double, double>()
        .property("x", &gp_Dir::X)
        .property("y", &gp_Dir::Y)
        .property("z", &gp_Dir::Z)
    ;
}