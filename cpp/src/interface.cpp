#include <emscripten/bind.h>
#include <string>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>

using namespace emscripten;
using namespace std;

class MyClass {
public:
  MyClass(int x, std::string y)
    : x(x)
    , y(y)
  {}

  void incrementX() {
    ++x;
  }

  int getX() const { return x; }
  void setX(int x_) { x = x_; }

  static std::string getStringFromInstance(const MyClass& instance) {
    return instance.y;
  }

private:
  int x;
  std::string y;
};

gp_Pnt makePnt(double x, double y, double z) {
    return gp_Pnt(x, y, z);
}

gp_Dir makeDir(const gp_Pnt& pnt1, const gp_Pnt& pnt2) {
  return gp_Dir(pnt2.X() - pnt1.X(), pnt2.Y() - pnt1.Y(), pnt2.Z() - pnt1.Z());
}

int addTest(int a, int b) {
  return a + b;
}

EMSCRIPTEN_BINDINGS(interface) {

  emscripten::function("addTest", &addTest);

  class_<MyClass>("MyClass")
    .constructor<int, std::string>()
    .function("incrementX", &MyClass::incrementX)
    .property("x", &MyClass::getX, &MyClass::setX)
    .property("x_readonly", &MyClass::getX)
    .class_function("getStringFromInstance", &MyClass::getStringFromInstance)
    ;

    emscripten::function("makePnt", &makePnt);
    emscripten::function("makeDir", &makeDir);


}