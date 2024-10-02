#include <TopoDS_Shape.hxx>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>

using namespace emscripten;

class Converter {
public:
    static std::string convertToBrep(const TopoDS_Shape& input) {
        std::ostringstream oss;
        BRepTools::Write(input, oss);
        return oss.str();
    }

    static TopoDS_Shape convertFromBrep(const std::string& input) {
        std::istringstream iss(input);
        TopoDS_Shape output;
        BRep_Builder builder;
        BRepTools::Read(output, iss, builder);
        return output;
    }

};

EMSCRIPTEN_BINDINGS(Converter)
{
    class_<Converter>("Converter")
        .class_function("convertToBrep", &Converter::convertToBrep)
        .class_function("convertFromBrep", &Converter::convertFromBrep)
    ;
}