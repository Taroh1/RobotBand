cmake_minimum_required(VERSION 3.24)
project(RobotBandController LANGUAGES CXX)
set(CMAKE_CONFIGURATION_TYPES Debug Develop Release CACHE STRING "" FORCE)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT WIN32 OR NOT BHUMAN_ROOT)
  message(FATAL_ERROR "This demo requires Windows and -DBHUMAN_ROOT=<BHumanCodeRelease>.")
endif()

set(SIMROBOT_ROOT "${BHUMAN_ROOT}/Util/SimRobot")
set(QT_ROOT "${SIMROBOT_ROOT}/Util/qt/Windows")
add_library(RobotBandController MODULE RobotBandController.cpp BandBridge.cpp)
target_link_libraries(RobotBandController PRIVATE winhttp)
add_executable(RobotBandBridgeProbe BridgeProbe.cpp BandBridge.cpp)
target_link_libraries(RobotBandBridgeProbe PRIVATE winhttp)
target_compile_definitions(RobotBandController PRIVATE WINDOWS NOMINMAX)
target_compile_options(RobotBandController PRIVATE /W4 /EHsc /utf-8 /Zc:__cplusplus /permissive-)
target_include_directories(RobotBandController PRIVATE
  "${SIMROBOT_ROOT}/Src/SimRobot"
  "${SIMROBOT_ROOT}/Src/SimRobotCore3"
  "${QT_ROOT}/include"
  "${QT_ROOT}/include/QtCore"
  "${QT_ROOT}/include/QtGui"
  "${QT_ROOT}/include/QtWidgets")
foreach(MODULE Core Gui Widgets)
  target_link_libraries(RobotBandController PRIVATE
    "$<IF:$<CONFIG:Debug>,${QT_ROOT}/lib/Qt6${MODULE}d.lib,${QT_ROOT}/lib/Qt6${MODULE}.lib>")
endforeach()
set_target_properties(RobotBandController PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${BHUMAN_ROOT}/Build/Windows/SimRobot/$<CONFIG>"
  LIBRARY_OUTPUT_DIRECTORY "${BHUMAN_ROOT}/Build/Windows/SimRobot/$<CONFIG>")

target_compile_definitions(RobotBandBridgeProbe PRIVATE WINDOWS NOMINMAX)
target_compile_options(RobotBandBridgeProbe PRIVATE /W4 /EHsc /utf-8 /Zc:__cplusplus /permissive-)
target_include_directories(RobotBandBridgeProbe PRIVATE "${QT_ROOT}/include" "${QT_ROOT}/include/QtCore")
target_link_libraries(RobotBandBridgeProbe PRIVATE "$<IF:$<CONFIG:Debug>,${QT_ROOT}/lib/Qt6Cored.lib,${QT_ROOT}/lib/Qt6Core.lib>")
set_target_properties(RobotBandBridgeProbe PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${BHUMAN_ROOT}/Build/Windows/SimRobot/$<CONFIG>")
