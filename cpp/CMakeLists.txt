cmake_minimum_required(VERSION 3.30)

project(chili-wasm VERSION 0.4.0)

set(CMAKE_CXX_STANDARD 17)
set(TARGET chili-wasm)

get_filename_component(SOURCE_ROOT_DIR ${CMAKE_SOURCE_DIR} DIRECTORY)
set(CMAKE_INSTALL_PREFIX "${SOURCE_ROOT_DIR}/packages/chili-wasm/lib")
message(STATUS "CMAKE_INSTALL_PREFIX: ${CMAKE_INSTALL_PREFIX}")

set(OCCT_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/build/target/occt/include/opencascade)
set(OCCT_LIB_DIR ${CMAKE_SOURCE_DIR}/build/target/occt/lib)
set(OCCT_LIBS
    # FoundationClasses
    TKernel TKMath
    # ModelingData
    TKG2d TKG3d TKGeomBase TKBRep
    # ModelingAlgorithms
    TKBO TKBool TKGeomAlgo TKHLR TKMesh TKPrim TKShHealing TKTopAlgo
    # Visualization
    TKMeshVS TKService
    # ApplicationFramework
    TKBin TKBinL TKBinXCAF TKCAF TKCDF TKLCAF TKVCAF TKXml TKXmlL
    # DataExchange
    TKXCAF TKXmlXCAF TKXSBase
    # 7.8 DataExchange
    TKDE TKDEIGES TKDESTEP TKDESTL TKDEVRML TKDEOBJ TKDEGLTF TKRWMesh
)

if (CMAKE_SYSTEM_NAME STREQUAL Emscripten)
    message(STATUS "EMSCRIPTEN: ${EMSCRIPTEN}")

    add_executable(${TARGET} src/mesher.cpp src/opencascade.cpp src/shapeFactory.cpp)

    target_compile_options (${TARGET} PUBLIC -O3)
    target_compile_options (${TARGET} PUBLIC -flto)
    target_compile_options (${TARGET} PUBLIC -fexceptions)
    target_compile_options (${TARGET} PUBLIC -sDISABLE_EXCEPTION_CATCHING=1)
    target_compile_options (${TARGET} PUBLIC -DIGNORE_NO_ATOMICS=1)
    target_compile_options (${TARGET} PUBLIC -frtti)

    target_link_options (${TARGET} PUBLIC -O3)
    target_link_options (${TARGET} PUBLIC -flto)
    target_link_options (${TARGET} PUBLIC -sEXPORT_ES6=1)
    target_link_options (${TARGET} PUBLIC -sMODULARIZE=1)
    target_link_options (${TARGET} PUBLIC -sENVIRONMENT="web")
    target_link_options (${TARGET} PUBLIC -sEXPORT_NAME='ChiliWasm')
    target_link_options (${TARGET} PUBLIC -sALLOW_MEMORY_GROWTH=1)
    target_link_options (${TARGET} PUBLIC -sDISABLE_EXCEPTION_CATCHING=1)
    target_link_options (${TARGET} PUBLIC -sEXPORTED_RUNTIME_METHODS=["FS"])
    target_link_options (${TARGET} PUBLIC --bind)
    target_link_options (${TARGET} PUBLIC --emit-tsd "${TARGET}.d.ts")

    target_include_directories(${TARGET} PUBLIC src)
    target_include_directories(${TARGET} PUBLIC ${CMAKE_SOURCE_DIR}/build/emsdk/upstream/emscripten/system/include)
    target_include_directories(${TARGET} PUBLIC ${OCCT_INCLUDE_DIR})
    target_link_directories(${TARGET} PUBLIC ${OCCT_LIB_DIR})
    target_link_libraries(${TARGET} PUBLIC ${OCCT_LIBS})

    install(TARGETS ${TARGET} DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.wasm DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.d.ts DESTINATION ${CMAKE_INSTALL_PREFIX})

endif ()

