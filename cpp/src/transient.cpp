// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <Standard_Transient.hxx>

using namespace emscripten;

class Transient {
public:
    static bool isKind(const Standard_Transient* t, const std::string& name)
    {
        return t->IsKind(name.c_str());
    }

    static bool isInstance(const Standard_Transient* t, const std::string& name)
    {
        return t->IsInstance(name.c_str());
    }
};

EMSCRIPTEN_BINDINGS(Transient)
{
    class_<Transient>("Transient")
        .class_function("isKind", &Transient::isKind, allow_raw_pointers())
        .class_function("isInstance", &Transient::isInstance,
            allow_raw_pointers());
}