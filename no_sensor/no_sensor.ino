/*
 * no_sensor.ino — firmware Wi-Fi do nó de monitoramento.
 * A cada 15 s lê os três sensores e envia JSON para POST http://<pc>:3000/readings.
 * Antes de gravar: edite config.h (rede, senha e NODE_ID da caixa).
 *
 * Papéis desde 24/10 (os fios continuam nos mesmos pinos):
 *   nível = capacitivo no rio (GPIO32, sempre ligado)
 *   chuva = placa FC-37        (GPIO35, ligada só na leitura pelo GPIO26)
 *   solo  = FD10 no copinho    (GPIO34, ligado só na leitura pelo GPIO25)
 */

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "config.h"

namespace {

constexpr uint32_t BAUD = 115200;
// The FD10 drifts by electrolysis when it is read often. 15 s keeps the drift small.
constexpr uint32_t READ_INTERVAL_MS = 15000;
constexpr uint16_t SETTLE_MS = 100;
constexpr size_t SAMPLES_PER_READING = 64;
constexpr uint32_t WIFI_TIMEOUT_MS = 20000;
constexpr uint16_t HTTP_TIMEOUT_MS = 5000;
constexpr uint16_t DISCOVERY_PORT = 4210;
constexpr uint32_t DISCOVERY_TIMEOUT_MS = 6000;
constexpr uint8_t FAILURES_BEFORE_REDISCOVERY = 3;
constexpr char DISCOVERY_PREFIX[] = "TCC-SERVIDOR;";
constexpr int8_t ALWAYS_ON = -1;

struct Sensor {
  uint8_t adcPin;  // Use only ADC1 (GPIO 32-39). ADC2 does not work when Wi-Fi is on.
  int8_t powerPin;
};

constexpr Sensor LEVEL{32, ALWAYS_ON};
constexpr Sensor RAIN{35, 26};
constexpr Sensor SOIL{34, 25};

struct Reading {
  uint32_t mv;
  uint16_t raw;
};

String g_serverUrl = SERVER_URL;
uint8_t g_consecutiveFailures = 0;
uint32_t g_seq = 0;
uint32_t g_lastReadMs = 0;
bool g_firstReading = true;

bool discoverServer();

bool isSwitched(const Sensor& sensor) { return sensor.powerPin != ALWAYS_ON; }

template <typename T>
T median(T* values, size_t count) {
  std::sort(values, values + count);
  return values[count / 2];
}

Reading sample(uint8_t adcPin) {
  uint32_t mv[SAMPLES_PER_READING];
  uint16_t raw[SAMPLES_PER_READING];
  for (size_t i = 0; i < SAMPLES_PER_READING; ++i) {
    raw[i] = analogRead(adcPin);
    mv[i] = analogReadMilliVolts(adcPin);
  }
  return {median(mv, SAMPLES_PER_READING), median(raw, SAMPLES_PER_READING)};
}

Reading readSensor(const Sensor& sensor) {
  if (!isSwitched(sensor)) return sample(sensor.adcPin);

  digitalWrite(sensor.powerPin, HIGH);
  delay(SETTLE_MS);
  const Reading reading = sample(sensor.adcPin);
  digitalWrite(sensor.powerPin, LOW);
  return reading;
}

bool waitForWifi() {
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.printf("# conectando ao Wi-Fi \"%s\"...\n", WIFI_SSID);
  WiFi.reconnect();
  if (!waitForWifi()) {
    Serial.println("# Wi-Fi indisponivel; nova tentativa na proxima leitura");
    return false;
  }
  Serial.printf("# Wi-Fi conectado. IP do ESP32: %s\n", WiFi.localIP().toString().c_str());
  discoverServer();
  return true;
}

long announcedPort(const char* message) {
  const size_t prefixLength = strlen(DISCOVERY_PREFIX);
  const bool isServerAnnouncement = strncmp(message, DISCOVERY_PREFIX, prefixLength) == 0;
  return isServerAnnouncement ? strtol(message + prefixLength, nullptr, 10) : 0;
}

bool discoverServer() {
  WiFiUDP udp;
  if (!udp.begin(DISCOVERY_PORT)) return false;

  bool found = false;
  const uint32_t start = millis();
  while (!found && millis() - start < DISCOVERY_TIMEOUT_MS) {
    if (udp.parsePacket() > 0) {
      char message[64];
      const int length = udp.read(message, sizeof(message) - 1);
      message[length > 0 ? length : 0] = '\0';
      const long port = announcedPort(message);
      const bool isValidPort = port > 0 && port < 65536;
      if (isValidPort) {
        g_serverUrl = "http://" + udp.remoteIP().toString() + ":" + String(static_cast<unsigned>(port)) + "/readings";
        found = true;
      }
    }
    delay(20);
  }
  udp.stop();

  if (found) {
    Serial.printf("# servidor encontrado na rede: %s\n", g_serverUrl.c_str());
  } else {
    Serial.printf("# nenhum anuncio do servidor; usando o config.h: %s\n", g_serverUrl.c_str());
  }
  return found;
}

String buildPayload(uint32_t seq, const Reading& level, const Reading& rain, const Reading& soil) {
  char json[256];
  snprintf(json, sizeof(json),
           "{\"node_id\":%u,\"seq\":%lu,\"uptime_ms\":%lu,"
           "\"level_mv\":%lu,\"level_raw\":%u,"
           "\"rain_mv\":%lu,\"rain_raw\":%u,"
           "\"soil_mv\":%lu,\"soil_raw\":%u}",
           static_cast<unsigned>(NODE_ID), static_cast<unsigned long>(seq),
           static_cast<unsigned long>(millis()),
           static_cast<unsigned long>(level.mv), static_cast<unsigned>(level.raw),
           static_cast<unsigned long>(rain.mv), static_cast<unsigned>(rain.raw),
           static_cast<unsigned long>(soil.mv), static_cast<unsigned>(soil.raw));
  return String(json);
}

// Returns the HTTP status, or a negative value when the connection fails.
int postReading(const String& payload) {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(g_serverUrl)) return -1;
  http.addHeader("Content-Type", "application/json");
  const int status = http.POST(payload);
  http.end();
  return status;
}

bool isTimeToRead() {
  return g_firstReading || millis() - g_lastReadMs >= READ_INTERVAL_MS;
}

void readAndSend() {
  g_firstReading = false;
  g_lastReadMs = millis();

  const Reading level = readSensor(LEVEL);
  const Reading rain = readSensor(RAIN);
  const Reading soil = readSensor(SOIL);
  const String payload = buildPayload(++g_seq, level, rain, soil);
  Serial.println(payload);

  if (!ensureWifi()) return;

  const int status = postReading(payload);
  const bool serverStoredReading = status >= 200 && status < 300;
  if (serverStoredReading) {
    g_consecutiveFailures = 0;
    Serial.printf("# enviado (%d)\n", status);
    return;
  }

  if (status > 0) {
    Serial.printf("# servidor recusou a leitura (HTTP %d)\n", status);
  } else {
    Serial.printf("# falha no envio para %s (%s). O servidor esta rodando?\n", g_serverUrl.c_str(),
                  HTTPClient::errorToString(status).c_str());
  }
  if (++g_consecutiveFailures >= FAILURES_BEFORE_REDISCOVERY) {
    Serial.println("# procurando o servidor de novo na rede...");
    discoverServer();
    g_consecutiveFailures = 0;
  }
}

}  // namespace

void setup() {
  Serial.begin(BAUD);

  for (const Sensor* sensor : {&LEVEL, &RAIN, &SOIL}) {
    if (!isSwitched(*sensor)) continue;
    pinMode(sensor->powerPin, OUTPUT);
    digitalWrite(sensor->powerPin, LOW);
  }
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.printf("# no %u\n", static_cast<unsigned>(NODE_ID));
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("# conectando ao Wi-Fi \"%s\"...\n", WIFI_SSID);
  if (waitForWifi()) {
    Serial.printf("# Wi-Fi conectado. IP do ESP32: %s\n", WiFi.localIP().toString().c_str());
    discoverServer();
  } else {
    Serial.println("# Wi-Fi ainda nao conectou; confira nome e senha em config.h");
  }
}

void loop() {
  if (isTimeToRead()) readAndSend();
  delay(10);
}
