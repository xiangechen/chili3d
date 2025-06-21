// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#pragma once

#include <cfloat>
#include <cmath>
#include <functional>

namespace impl {
template <typename T>
[[nodiscard]] inline bool isApprox0(const T value) noexcept
{
    return std::abs(value) < std::numeric_limits<T>::epsilon();
}
}

class Vector3f {
public:
    constexpr Vector3f(float x, float y, float z) noexcept
        : _x(x)
        , _y(y)
        , _z(z)
    {
    }
    constexpr Vector3f(float v) noexcept
        : Vector3f(v, v, v)
    {
    }
    constexpr Vector3f() noexcept
        : Vector3f(0.0f)
    {
    }

    float& x() { return _x; }
    float& y() { return _y; }
    float& z() { return _z; }

    constexpr float x() const noexcept { return _x; }
    constexpr float y() const noexcept { return _y; }
    constexpr float z() const noexcept { return _z; }

    constexpr float squaredNorm() const noexcept { return x() * x() + y() * y() + z() * z(); }
    constexpr float lengthSquared() const noexcept { return squaredNorm(); }
    float norm() const noexcept { return std::sqrt(squaredNorm()); }
    float length() const noexcept { return norm(); }

    Vector3f& operator+=(const Vector3f& other) noexcept
    {
        x() += other.x(), y() += other.y(), z() += other.z();
        return *this;
    }
    Vector3f& operator-=(const Vector3f& other) noexcept
    {
        x() -= other.x(), y() -= other.y(), z() -= other.z();
        return *this;
    }
    Vector3f& operator*=(float factor) noexcept
    {
        x() *= factor, y() *= factor, z() *= factor;
        return *this;
    }
    Vector3f& operator/=(float divisor) noexcept { return operator*=(1. / divisor); }

    // Do not change to approx!!!
    bool operator==(const Vector3f& other) const
    {
        return _x == other._x && _y == other._y && _z == other._z;
    }

    bool operator<(const Vector3f& other) const
    {
        if (_x != other._x) {
            return _x < other._x;
        }

        if (_y != other._y) {
            return _y < other._y;
        }

        return _z < other._z;
    }

    inline void normalize() noexcept
    {
        const float len = squaredNorm();
        if (impl::isApprox0(len)) {
            return;
        }
        operator/=(std::sqrt(len));
    }

    inline Vector3f normalized() const noexcept
    {
        Vector3f v(*this);
        v.normalize();
        return v;
    }

    static Vector3f crossProduct(const Vector3f& v1, const Vector3f& v2) noexcept
    {
        return { v1.y() * v2.z() - v1.z() * v2.y(), v1.z() * v2.x() - v1.x() * v2.z(),
            v1.x() * v2.y() - v1.y() * v2.x() };
    }

    bool isApprox0() const noexcept
    {
        return impl::isApprox0(x()) && impl::isApprox0(y()) && impl::isApprox0(z());
    }

    bool isApprox(const Vector3f& other) const noexcept
    {
        return impl::isApprox0(x() - other.x()) && impl::isApprox0(y() - other.y()) && impl::isApprox0(z() - other.z());
    }

    friend constexpr Vector3f operator-(const Vector3f& v) { return { -v.x(), -v.y(), -v.z() }; }

    friend constexpr Vector3f operator+(const Vector3f& v1, const Vector3f& v2)
    {
        return { v1.x() + v2.x(), v1.y() + v2.y(), v1.z() + v2.z() };
    }
    friend constexpr Vector3f operator-(const Vector3f& v1, const Vector3f& v2)
    {
        return { v1.x() - v2.x(), v1.y() - v2.y(), v1.z() - v2.z() };
    }

    friend constexpr Vector3f operator*(const Vector3f& v, float factor)
    {
        return { v.x() * factor, v.y() * factor, v.z() * factor };
    }
    friend constexpr Vector3f operator*(float factor, const Vector3f& v) { return v * factor; }
    friend constexpr Vector3f operator/(const Vector3f& v, float divisor)
    {
        return operator*(v, 1.f / divisor);
    }

private:
    float _x;
    float _y;
    float _z;
};

struct Vector3fHash {
    size_t operator()(const Vector3f& v) const
    {
        return std::hash<float> {}(v.x()) ^ std::hash<float> {}(v.y()) << 1 ^ std::hash<float> {}(v.z()) << 2;
    }
};