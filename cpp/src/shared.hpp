#pragma once

#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace emscripten;

EMSCRIPTEN_DECLARE_VAL_TYPE(NumberArray)

EMSCRIPTEN_BINDINGS(Shared) {
    register_type<NumberArray>("Array<number>");
}