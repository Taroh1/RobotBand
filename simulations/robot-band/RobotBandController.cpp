// SimRobot choreography and read-only connection to the local website.
#include "BandBridge.h"
#include <SimRobotCore3.h>
#include <QDateTime>
#include <QCheckBox>
#include <QLabel>
#include <QPushButton>
#include <QSettings>
#include <QSpinBox>
#include <QVBoxLayout>
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <thread>

namespace
{
constexpr float pi = 3.14159265358979323846f;
constexpr std::array<const char*, 22> joints = {
  "HeadYaw", "HeadPitch", "LShoulderPitch", "LShoulderRoll", "LElbowPitch", "LElbowYaw",
  "RShoulderPitch", "RShoulderRoll", "RElbowPitch", "RElbowYaw",
  "LHipPitch", "LHipRoll", "LHipYaw", "LKneePitch", "LAnklePitch", "LAnkleRoll",
  "RHipPitch", "RHipRoll", "RHipYaw", "RKneePitch", "RAnklePitch", "RAnkleRoll"
};
constexpr std::array<std::array<float, 3>, 3> positions = {{
  {-0.55f, 1.85f, 0.957f}, {0.30f, 0.f, 0.737f}, {-0.15f, -1.85f, 0.737f}
}};

struct BandState
{
  bool liveMode = true;
  bool playing = true;
  int bpm = 120;
  double beats = 0.;
  std::array<bool, 3> enabled = {true, true, true};
  BandLiveState live;
};

class BandPanel : public QWidget, public SimRobot::Widget
{
  BandState& state;
  QLabel* beatLabel;
  QLabel* bridgeLabel;
  QPushButton* play;
  QSpinBox* tempo;
  std::array<QLabel*, 3> roleLabels{};
public:
  explicit BandPanel(BandState& state) : state(state)
  {
    setMinimumWidth(265);
    setMaximumWidth(360);
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(20, 22, 20, 22);
    auto* title = new QLabel("ROBOT BAND");
    title->setStyleSheet("font-size: 24px; font-weight: bold; color: #66e4cf;");
    layout->addWidget(title);
    auto* subtitle = new QLabel("Drei K1. Eine Buehne.");
    layout->addWidget(subtitle);
    layout->addSpacing(18);
    auto* live = new QCheckBox("Live von Launchpad-Webseite");
    live->setChecked(true);
    connect(live, &QCheckBox::toggled, this, [this](bool enabled) {
      this->state.liveMode = enabled;
      this->state.live.clear();
      this->state.playing = true;
      this->state.beats = 0.;
    });
    layout->addWidget(live);
    bridgeLabel = new QLabel;
    bridgeLabel->setWordWrap(true);
    layout->addWidget(bridgeLabel);
    play = new QPushButton;
    play->setMinimumHeight(38);
    connect(play, &QPushButton::clicked, this, [this] {
      this->state.playing = !this->state.playing;
      this->state.live.clear();
    });
    layout->addWidget(play);
    layout->addWidget(new QLabel("Tempo (BPM)"));
    tempo = new QSpinBox;
    tempo->setRange(40, 240);
    tempo->setValue(state.bpm);
    tempo->setAccessibleName("Tempo BPM");
    tempo->setMinimumHeight(32);
    connect(tempo, &QSpinBox::valueChanged, this, [this](int value) { this->state.bpm = value; });
    layout->addWidget(tempo);
    beatLabel = new QLabel;
    beatLabel->setMinimumHeight(40);
    beatLabel->setStyleSheet("font-size: 18px; font-weight: bold;");
    layout->addWidget(beatLabel);
    const std::array<const char*, 3> labels = {
      "bot-1  /  Schlagzeug", "bot-2  /  Gitarre", "bot-3  /  Keyboard"
    };
    for(unsigned i = 0; i < labels.size(); ++i)
    {
      auto* role = new QCheckBox(labels[i]);
      role->setChecked(true);
      connect(role, &QCheckBox::toggled, this, [this, i](bool enabled) { this->state.enabled[i] = enabled; });
      layout->addWidget(role);
      roleLabels[i] = new QLabel("Wartet auf Pad");
      roleLabels[i]->setStyleSheet("color: #a8b4bf; padding-left: 20px; font-size: 11px;");
      layout->addWidget(roleLabels[i]);
    }
    layout->addSpacing(16);
    auto* note = new QLabel("Audio und Launchpad: Website\nhttp://127.0.0.1:3210\n\nLive aus = automatische Demo.\nDie Figuren bleiben fixiert.\nKeine physische K1-Steuerung.");
    note->setWordWrap(true);
    note->setStyleSheet("color: #a8b4bf; font-size: 12px;");
    layout->addWidget(note);
    layout->addStretch();
    update();
  }
  QWidget* getWidget() override { return this; }
  void update() override
  {
    static const std::array<const char*, 4> chords = {"Cm", "Ab", "Eb", "Bb"};
    const int beat = static_cast<int>(state.beats);
    beatLabel->setText(state.liveMode ? QString("LIVE  |  %1 Signale").arg(state.live.received)
                                    : QString("%1  |  Beat %2 / 4").arg(chords[(beat / 4) % 4]).arg(beat % 4 + 1));
    bridgeLabel->setText(state.live.connectionMessage);
    bridgeLabel->setStyleSheet(state.live.connected ? "color: #66e4cf;" : "color: #ffbe5c;");
    play->setText(state.liveMode ? (state.playing ? "Live pausieren" : "Live freigeben")
                                : (state.playing ? "Demo pausieren" : "Demo starten"));
    tempo->setEnabled(!state.liveMode);
    if(state.liveMode) tempo->setValue(state.live.bpm);
    const double now = static_cast<double>(QDateTime::currentMSecsSinceEpoch());
    for(unsigned i = 0; i < roleLabels.size(); ++i)
    {
      const auto& gesture = state.live.robots[i];
      roleLabels[i]->setText(!state.liveMode ? "Demo" : gesture.active(now) && state.enabled[i] && state.playing
          ? gesture.animation + (gesture.chord.isEmpty() ? "" : " | " + gesture.chord) : "Wartet auf Pad");
    }
    QWidget::update();
  }
};

class PanelObject : public SimRobot::Object
{
  BandState& state;
  QString name = "Bandsteuerung";
public:
  explicit PanelObject(BandState& state) : state(state) {}
  const QString& getFullName() const override { return name; }
  SimRobot::Widget* createWidget() override { return new BandPanel(state); }
};

class RobotBandController : public SimRobot::Module
{
  SimRobot::Application& app;
  SimRobotCore3::Scene* scene = nullptr;
  BandState state;
  BandBridge bridge{[] {
    bool ok = false;
    const int port = qEnvironmentVariableIntValue("ROBOTBAND_BRIDGE_PORT", &ok);
    return static_cast<unsigned short>(ok && port > 0 && port <= 65535 ? port : 3210);
  }()};
  PanelObject panel{state};
  std::array<SimRobotCore3::Body*, 3> bodies{};
  std::array<std::array<SimRobotCore3::ActuatorPort*, 22>, 3> motors{};
  std::chrono::steady_clock::time_point nextStep = std::chrono::steady_clock::now();
  std::chrono::steady_clock::time_point lastBeatTick = nextStep;

  void pose(unsigned robot)
  {
    auto& m = motors[robot];
    // All positions are inside the K1 model limits. Puppet mode makes this a
    // kinematic visual demo, not a test of balance, force or instrument contact.
    for(auto* motor : m) motor->setValue(0.f);
    m[3]->setValue(-1.35f);
    m[7]->setValue(1.35f);
    m[4]->setValue(pi / 2.f);
    m[8]->setValue(pi / 2.f);
    float wave = std::sin(static_cast<float>(state.beats) * 2.f * pi);
    float alternate = std::sin(static_cast<float>(state.beats) * pi);
    float amount = state.enabled[robot] ? 1.f : 0.f;
    if(state.liveMode)
    {
      const auto& gesture = state.live.robots[robot];
      const double now = static_cast<double>(QDateTime::currentMSecsSinceEpoch());
      amount *= state.playing && state.live.connected && gesture.active(now) ? static_cast<float>(gesture.intensity) : 0.f;
      const float progress = gesture.durationMs > 0 ? static_cast<float>(std::clamp((now - gesture.beganMs) / gesture.durationMs, 0., 1.)) : 0.f;
      // One bounded stroke per trigger, returning to rest at the deadline.
      wave = std::sin(progress * pi);
      alternate = wave;
      if(gesture.animation == "hihat") wave *= 0.45f;
      if(gesture.animation == "kick") wave *= 0.65f;
      if(gesture.animation.endsWith("_high")) alternate *= -1.f;
    }
    m[0]->setValue(amount * 0.12f * alternate);
    m[1]->setValue(0.10f + amount * 0.05f * wave);
    if(robot == 0) // alternating drum strokes
    {
      m[2]->setValue(-0.75f + amount * 0.24f * wave);
      m[6]->setValue(-0.75f - amount * 0.24f * wave);
      m[5]->setValue(-0.28f);
      m[9]->setValue(0.28f);
    }
    else if(robot == 1) // fret hand and strumming arm
    {
      m[2]->setValue(-0.65f);
      m[3]->setValue(-0.90f);
      m[5]->setValue(-0.48f + amount * 0.10f * alternate);
      m[6]->setValue(-0.45f + amount * 0.20f * wave);
      m[9]->setValue(0.30f + amount * 0.12f * wave);
    }
    else // hands over the keys
    {
      m[2]->setValue(-0.90f + amount * 0.09f * wave);
      m[6]->setValue(-0.90f - amount * 0.09f * wave);
      m[5]->setValue(-0.32f);
      m[9]->setValue(0.32f);
    }
  }

public:
  explicit RobotBandController(SimRobot::Application& app) : app(app) {}
  bool compile() override
  {
    scene = dynamic_cast<SimRobotCore3::Scene*>(app.resolveObject("RobotBand", SimRobotCore3::scene));
    if(!scene) return false;
    for(unsigned i = 0; i < bodies.size(); ++i)
    {
      bodies[i] = dynamic_cast<SimRobotCore3::Body*>(app.resolveObject(QString("RobotBand.Band.bot-%1").arg(i + 1), SimRobotCore3::body));
      if(!bodies[i]) { app.showWarning("Robot Band", "Ein K1-Modell fehlt."); return false; }
      for(unsigned j = 0; j < joints.size(); ++j)
      {
        QVector<QString> suffix{QString(joints[j]) + ".position"};
        motors[i][j] = dynamic_cast<SimRobotCore3::ActuatorPort*>(app.resolveObject(suffix, bodies[i], SimRobotCore3::actuatorPort));
        if(!motors[i][j]) { app.showWarning("Robot Band", QString("Gelenk fehlt: %1").arg(joints[j])); return false; }
        motors[i][j]->setPuppetState(true);
      }
      bodies[i]->enablePhysics(false);
      pose(i);
    }
    app.registerObject(*this, panel, nullptr);
    return true;
  }
  void link() override
  {
    // Only set the initial camera; keep later camera adjustments across opens.
    auto& settings = app.getLayoutSettings();
    settings.beginGroup("RobotBand");
    if(!settings.contains("cameraPosX"))
    {
      settings.setValue("cameraPosX", 7.1f);
      settings.setValue("cameraPosY", -6.5f);
      settings.setValue("cameraPosZ", 4.4f);
      settings.setValue("cameraTargetX", -0.2f);
      settings.setValue("cameraTargetY", 0.f);
      settings.setValue("cameraTargetZ", 0.85f);
      settings.setValue("FovY", 42);
    }
    settings.endGroup();
    app.openObject(*scene);
    app.openObject(panel);
    app.setStatusMessage("Robot Band | Website-Bridge | 3 simulierte K1");
  }
  void update() override
  {
    // Limit busy looping. Windows timer precision can make the physics clock
    // slower than real time, so the music phase uses a monotonic wall clock.
    const auto wallNow = std::chrono::steady_clock::now();
    if(nextStep < wallNow) nextStep = wallNow;
    std::this_thread::sleep_until(nextStep);
    nextStep += std::chrono::microseconds(2000);
    const auto beatNow = std::chrono::steady_clock::now();
    const double dt = std::clamp(std::chrono::duration<double>(beatNow - lastBeatTick).count(), 0., 0.05);
    lastBeatTick = beatNow;
    state.live.accept(bridge.take(), static_cast<double>(QDateTime::currentMSecsSinceEpoch()));
    if(!state.playing || !state.liveMode) state.live.clear();
    if(state.playing) state.beats = std::fmod(state.beats + dt * state.bpm / 60., 16.);
    constexpr float identity[3][3] = {{1,0,0}, {0,1,0}, {0,0,1}};
    for(unsigned i = 0; i < bodies.size(); ++i)
    {
      bodies[i]->move(positions[i].data(), identity);
      bodies[i]->resetDynamics();
      pose(i);
    }
  }
};
}

extern "C" DLL_EXPORT SimRobot::Module* createModule(SimRobot::Application& app)
{
  return new RobotBandController(app);
}
