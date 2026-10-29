#include "BandBridge.h"
#include <Windows.h>
#include <winhttp.h>
#include <QByteArray>
#include <QJsonDocument>
#include <QJsonValue>
#include <QStringList>
#include <algorithm>
#include <chrono>
#include <cmath>

namespace
{
struct HttpHandle
{
  HINTERNET value = nullptr;
  explicit HttpHandle(HINTERNET value) : value(value) {}
  ~HttpHandle() { if(value) WinHttpCloseHandle(value); }
  operator HINTERNET() const { return value; }
};
bool allowedAnimation(unsigned robot, const QString& animation)
{
  if(robot == 0) return QStringList{"kick", "snare", "hihat", "tom", "cymbal"}.contains(animation);
  return (robot == 1 ? QStringList{"strum_low", "strum_mid", "strum_high"}
                     : QStringList{"keys_low", "keys_mid", "keys_high"}).contains(animation);
}
}

BandBridge::BandBridge(unsigned short port) : worker([this, port] { run(port); }) {}
BandBridge::~BandBridge()
{
  stopping = true;
  wake.notify_all();
  worker.join();
}
BridgeBatch BandBridge::take()
{
  std::lock_guard guard(mutex);
  BridgeBatch result{pending.connected, pending.generation, pending.message, {}};
  result.events.swap(pending.events);
  return result;
}
void BandBridge::connection(bool connected, const QString& message)
{
  std::lock_guard guard(mutex);
  pending.connected = connected;
  pending.message = message;
  ++pending.generation;
  pending.events.clear();
}
void BandBridge::run(unsigned short port)
{
  while(!stopping)
  {
    bool streamOK = false;
    {
      HttpHandle session(WinHttpOpen(L"RobotBand-SimRobot/1", WINHTTP_ACCESS_TYPE_NO_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
      if(session) WinHttpSetTimeouts(session, 1000, 1000, 1000, 2500);
      HttpHandle host(session ? WinHttpConnect(session, L"127.0.0.1", port, 0) : nullptr);
      HttpHandle request(host ? WinHttpOpenRequest(host, L"GET", L"/api/stream", nullptr,
                                                 WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0) : nullptr);
      if(request)
      {
        DWORD redirects = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        WinHttpSetOption(request, WINHTTP_OPTION_REDIRECT_POLICY, &redirects, sizeof(redirects));
        if(!stopping && WinHttpSendRequest(request, L"Accept: text/event-stream\r\nX-RobotBand-Client: simrobot-v1\r\n", static_cast<DWORD>(-1),
                                          WINHTTP_NO_REQUEST_DATA, 0, 0, 0)
           && !stopping && WinHttpReceiveResponse(request, nullptr))
        {
          DWORD status = 0, size = sizeof(status);
          wchar_t contentType[128]{};
          DWORD typeSize = sizeof(contentType);
          streamOK = WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                         WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX)
                     && status == 200
                     && WinHttpQueryHeaders(request, WINHTTP_QUERY_CONTENT_TYPE, WINHTTP_HEADER_NAME_BY_INDEX,
                                            contentType, &typeSize, WINHTTP_NO_HEADER_INDEX)
                     && QString::fromWCharArray(contentType).startsWith("text/event-stream");
          if(streamOK)
          {
            connection(true, "Website verbunden");
            QByteArray buffer;
            char chunk[8192];
            while(!stopping)
            {
              DWORD count = 0;
              DWORD available = 0;
              if(!WinHttpQueryDataAvailable(request, &available) || available == 0 || stopping) break;
              if(!WinHttpReadData(request, chunk, std::min<DWORD>(available, sizeof(chunk)), &count) || count == 0) break;
              buffer.append(chunk, static_cast<int>(count));
              buffer.replace("\r\n", "\n");
              if(buffer.size() > 65536) break;
              qsizetype end;
              bool overflow = false;
              while((end = buffer.indexOf("\n\n")) >= 0)
              {
                const auto block = buffer.left(end);
                buffer.remove(0, end + 2);
                QByteArray data;
                for(const auto& line : block.split('\n'))
                  if(line.startsWith("data:")) { if(!data.isEmpty()) data += '\n'; data += line.mid(5).trimmed(); }
                if(data.isEmpty() || data.size() > 8192) continue;
                const auto document = QJsonDocument::fromJson(data);
                if(!document.isObject()) continue;
                std::lock_guard guard(mutex);
                if(pending.events.size() >= 128) { overflow = true; break; }
                pending.events.push_back(document.object());
              }
              if(overflow) break;
            }
          }
        }
      }
    }
    connection(false, streamOK ? "Verbindung unterbrochen - erneuter Versuch ..." : "Website offline - npm.cmd start ausfuehren");
    std::unique_lock lock(mutex);
    wake.wait_for(lock, std::chrono::milliseconds(750), [this] { return stopping.load(); });
  }
}

void BandLiveState::clear() { robots = {}; }
void BandLiveState::accept(BridgeBatch batch, double nowMs)
{
  if(batch.generation != generation || !batch.connected)
  {
    clear();
    lastSequence = 0.;
    generation = batch.generation;
  }
  connected = batch.connected;
  connectionMessage = batch.message;
  if(!connected) return;
  for(const auto& event : batch.events)
  {
    if(event.value("schema_version").toInt() != 1) continue;
    const double seq = event.value("sequence").toDouble(-1);
    if(!std::isfinite(seq) || seq <= lastSequence || std::floor(seq) != seq) continue;
    lastSequence = seq;
    const QString id = event.value("robot_id").toString();
    const int index = id == "bot-1" ? 0 : id == "bot-2" ? 1 : id == "bot-3" ? 2 : -1;
    if(index < 0) continue; // vocals have no physical or simulated robot
    const QString type = event.value("type").toString();
    if(type == "stop" && event.value("scope").toString() == "robot")
    {
      robots[index] = {};
      ++received;
      continue;
    }
    // A pad release must not cancel another chord or a one-shot gesture.
    if(type != "trigger" || event.value("scope").toString() != "role") continue;
    const QString animation = event.value("animation").toString();
    const double duration = event.value("duration_ms").toDouble(-1);
    const double timestamp = event.value("timestamp_ms").toDouble(-1);
    const double intensity = event.value("intensity").toDouble(-1);
    const double tempo = event.value("bpm").toDouble(-1);
    if(!allowedAnimation(index, animation) || !std::isfinite(duration) || duration < 80 || duration > 1500
       || !std::isfinite(timestamp) || timestamp > nowMs + 100 || timestamp + duration <= nowMs
       || !std::isfinite(intensity) || intensity < 0 || intensity > 1
       || !std::isfinite(tempo) || tempo < 40 || tempo > 240) continue;
    robots[index] = {animation, event.value("chord").toString(), intensity, timestamp, timestamp + duration, duration};
    bpm = static_cast<int>(tempo);
    ++received;
  }
}
