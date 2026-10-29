#pragma once

#include <QJsonObject>
#include <QString>
#include <array>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>

struct BridgeBatch
{
  bool connected = false;
  std::uint64_t generation = 0;
  QString message = "Website wird gesucht ...";
  std::vector<QJsonObject> events;
};

// A bounded, read-only SSE consumer. Only the worker owns WinHTTP handles.
// Timeouts bound shutdown; a UI thread never closes an in-flight sync handle.
class BandBridge
{
public:
  explicit BandBridge(unsigned short port = 3210);
  ~BandBridge();
  BridgeBatch take();
private:
  std::atomic<bool> stopping{false};
  std::mutex mutex;
  std::condition_variable wake;
  BridgeBatch pending;
  std::thread worker;
  void run(unsigned short port);
  void connection(bool connected, const QString& message);
};

struct LiveGesture
{
  QString animation;
  QString chord;
  double intensity = 0.;
  double beganMs = 0.;
  double untilMs = 0.;
  double durationMs = 0.;
  bool active(double nowMs) const { return nowMs < untilMs; }
};

class BandLiveState
{
public:
  std::array<LiveGesture, 3> robots{};
  bool connected = false;
  QString connectionMessage = "Website wird gesucht ...";
  std::uint64_t received = 0;
  int bpm = 120;
  void accept(BridgeBatch batch, double nowMs);
  void clear();
private:
  std::uint64_t generation = 0;
  double lastSequence = 0.;
};
