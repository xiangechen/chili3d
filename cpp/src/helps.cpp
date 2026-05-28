// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <BRep_Tool.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
using namespace emscripten;

class BrepHelps {
};

EMSCRIPTEN_BINDINGS(BrepHelps)
{
    emscripten::class_<BrepHelps>("BrepHelps")
        .class_function("isClosed", select_overload<bool(const TopoDS_Edge&, const TopoDS_Face&)>(&BRep_Tool::IsClosed))
        .class_function("hasContinue", select_overload<bool(const TopoDS_Edge&, const TopoDS_Face&, const TopoDS_Face&)>(&BRep_Tool::HasContinuity))
        .class_function("hasSomeContinue", select_overload<bool(const TopoDS_Edge&)>(&BRep_Tool::HasContinuity))
        .class_function("continuity", select_overload<GeomAbs_Shape(const TopoDS_Edge&, const TopoDS_Face&, const TopoDS_Face&)>(&BRep_Tool::Continuity));
}