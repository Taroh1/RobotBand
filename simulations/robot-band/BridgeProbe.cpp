// Native integration probe: the same SSE consumer and gesture state as the GUI.
#include "BandBridge.h"
#include <QCoreApplication>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <chrono>
#include <iostream>
#include <thread>

int main(int argc, char** argv)
{
  QCoreApplication app(argc, argv);
  if(argc < 2) return 2;
  const int port = QString(argv[1]).toInt();
  if(port < 1 || port > 65535) return 2;
  BandBridge bridge(static_cast<unsigned short>(port));
  BandLiveState state;
  const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(20);
  QByteArray previous;
  while(std::chrono::steady_clock::now() < end)
  {
    const double now = static_cast<double>(QDateTime::currentMSecsSinceEpoch());
    state.accept(bridge.take(), now);
    QJsonArray robots;
    for(const auto& robot : state.robots)
      robots.append(QJsonObject{{"active", robot.active(now)}, {"animation", robot.animation}, {"intensity", robot.intensity}});
    const auto json = QJsonDocument(QJsonObject{{"connected", state.connected}, {"received", static_cast<double>(state.received)}, {"robots", robots}}).toJson(QJsonDocument::Compact);
    if(json != previous) { std::cout << json.constData() << std::endl; previous = json; }
    QCoreApplication::processEvents();
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
}
