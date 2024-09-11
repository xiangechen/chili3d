#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <gp_Ax2.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <TopoDS_Shape.hxx>

using namespace emscripten;

class ShapeFactory {
public:
    static TopoDS_Shape makeBox(gp_Ax2 ax, double x, double y, double z)
    {
        BRepPrimAPI_MakeBox box(ax, x, y, z);
        return box.Shape();
    }
};

EMSCRIPTEN_BINDINGS(ShapeFactory)
{
    class_<ShapeFactory>("ShapeFactory")
        .class_function("makeBox", &ShapeFactory::makeBox)
    ;
}