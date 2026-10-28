/*
 * calibracao_bancada.ino  (v3: 5 leituras por ponto, a cada 3 s)
 * Firmware de BANCADA para caracterizacao e calibracao dos sensores (TCC enchentes).
 * Nao e o firmware final do no: so le os sensores e imprime CSV na serial.
 *
 * Ligacoes (tudo em 3,3 V -- nunca 5 V: o modulo de chuva alimentado em 5 V
 * pode colocar ate 5 V no pino A0 e danificar o ESP32):
 *   Nivel: capacitivo no rio   AOUT -> GPIO32 | VCC -> 3V3 (continuo) | GND -> GND
 *   Chuva (LM393)              A0 -> GPIO35 | VCC -> GPIO26 (alimentacao chaveada) | GND -> GND | D0 nao usado
 *   Solo: FD10 no copinho      S -> GPIO34 | + -> GPIO25 (alimentacao chaveada) | - -> GND
 *   Desde 24/10 os papeis foram trocados: o FD10 derivou ~50% em 2 h com a agua parada (eletrolise);
 *   o capacitivo nao toca a agua e ficou estavel. Os fios continuam nos mesmos pinos.
 * Apenas pinos do ADC1 (GPIO 32-39) sao usados, porque o ADC2 nao funciona com Wi-Fi ligado.
 *
 * Uso: Monitor Serial a 115200 baud, final de linha "Nova linha" (LF).
 *   nivel 2,4             -> 5 leituras do nivel (uma a cada 3 s) com a referencia "2.4" (cm na regua)
 *   solo A3               -> 5 leituras do solo com a referencia "A3" (codigo da amostra)
 *   chuva seco            -> 5 leituras da placa de chuva com a referencia "seco"
 *   serie chuva 900       -> uma leitura a cada 2 s por 900 s; Enter interrompe
 *   serie nivel 300 15    -> uma leitura a cada 15 s por 300 s (intervalo opcional, em s)
 *   transiente solo       -> liga o FD10 e le em 5, 20, 50, 100, 200, 500, 1000 e 2000 ms
 *   espera 500            -> muda para 500 ms a espera entre ligar o sensor e ler (padrao 100)
 *   ajuda                 -> mostra os comandos
 *
 * Saida CSV: millis,sensor,referencia,leitura,mv,raw
 *   mv  = mediana de 64 amostras em milivolts (analogReadMilliVolts, calibracao de fabrica do chip)
 *   raw = mediana de 64 amostras em contagens do ADC (0-4095)
 */

#include <Arduino.h>
#include <algorithm>
#include <cctype>
#include <cstdio>

namespace {

constexpr uint32_t BAUD = 115200;
constexpr size_t SAMPLES_PER_READING = 64;    // amostras por leitura (usa a mediana)
// Many fast pulses make the FD10 reading fall (electrolysis). Read few times, with long intervals.
constexpr size_t READINGS_PER_POINT = 5;      // leituras por ponto de calibracao
constexpr uint32_t READING_INTERVAL_MS = 3000;
constexpr uint32_t DEFAULT_SERIES_INTERVAL_S = 2;
constexpr uint32_t CAPACITIVE_WARMUP_MS = 1000;
constexpr uint16_t MAX_SETTLE_MS = 5000;
constexpr uint16_t TRANSIENT_MARKS_MS[] = {5, 20, 50, 100, 200, 500, 1000, 2000};

// Espera entre energizar um sensor chaveado e ler. Ajustavel pelo comando "espera".
uint16_t g_settleMs = 100;

struct Sensor {
  const char* name;
  uint8_t adcPin;   // somente ADC1 (GPIO 32-39)
  int8_t powerPin;  // -1 = alimentacao continua
};

// Power the FD10 and the rain plate only during a reading, to decrease electrolysis and corrosion.
constexpr Sensor SENSORS[] = {
    {"nivel", 32, -1},
    {"chuva", 35, 26},
    {"solo", 34, 25},
};

struct Reading {
  uint32_t mv;
  uint16_t raw;
};

template <typename T>
T median(T* values, size_t count) {
  std::sort(values, values + count);
  return values[count / 2];
}

bool isSwitched(const Sensor& sensor) { return sensor.powerPin >= 0; }

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
  delay(g_settleMs);
  const Reading reading = sample(sensor.adcPin);
  digitalWrite(sensor.powerPin, LOW);
  return reading;
}

const Sensor* findSensor(const String& name) {
  for (const Sensor& sensor : SENSORS) {
    if (name.equalsIgnoreCase(sensor.name)) return &sensor;
  }
  return nullptr;
}

// Virgula decimal (2,4) vira ponto (2.4) para nao quebrar o CSV.
String sanitizeReference(String reference) {
  reference.trim();
  reference.replace(',', '.');
  return reference.length() > 0 ? reference : String("-");
}

void printRow(const Sensor& sensor, const char* reference, size_t index, const Reading& reading) {
  Serial.printf("%lu,%s,%s,%u,%lu,%u\n",
                static_cast<unsigned long>(millis()), sensor.name, reference,
                static_cast<unsigned>(index), static_cast<unsigned long>(reading.mv),
                static_cast<unsigned>(reading.raw));
}

// Espera ms milissegundos; retorna true se o usuario apertou Enter (interrompe).
bool waitOrInterrupted(uint32_t ms) {
  const uint32_t start = millis();
  while (millis() - start < ms) {
    if (Serial.available()) {
      Serial.readStringUntil('\n');
      return true;
    }
    delay(20);
  }
  return false;
}

void measurePoint(const Sensor& sensor, const String& reference) {
  for (size_t i = 1; i <= READINGS_PER_POINT; ++i) {
    printRow(sensor, reference.c_str(), i, readSensor(sensor));
    if (i < READINGS_PER_POINT && waitOrInterrupted(READING_INTERVAL_MS)) {
      Serial.println("# ponto interrompido");
      return;
    }
  }
  Serial.println("# ponto concluido");
}

void measureSeries(const Sensor& sensor, uint32_t seconds, uint32_t intervalS) {
  const uint32_t start = millis();
  size_t index = 0;
  while (millis() - start < seconds * 1000UL) {
    printRow(sensor, "serie", ++index, readSensor(sensor));
    if (waitOrInterrupted(intervalS * 1000UL)) {
      Serial.println("# serie interrompida");
      return;
    }
  }
  Serial.println("# serie concluida");
}

// Mantem o sensor ligado e le em instantes fixos apos energizar: mostra quanto tempo a leitura leva
// para se acomodar e se ela deriva enquanto o sensor esta ligado.
void measureTransient(const Sensor& sensor) {
  if (!isSwitched(sensor)) {
    Serial.println("# este sensor fica sempre ligado; transiente nao se aplica");
    return;
  }
  digitalWrite(sensor.powerPin, HIGH);
  const uint32_t start = millis();
  size_t index = 0;
  for (uint16_t markMs : TRANSIENT_MARKS_MS) {
    while (millis() - start < markMs) {
    }
    char reference[16];
    snprintf(reference, sizeof(reference), "t%ums", static_cast<unsigned>(markMs));
    printRow(sensor, reference, ++index, sample(sensor.adcPin));
  }
  digitalWrite(sensor.powerPin, LOW);
  Serial.println("# transiente concluido");
}

void printHelp() {
  Serial.println("# Comandos:");
  Serial.println("#   <sensor> <referencia>                  ex.: nivel 2,4 | solo A3 | chuva seco");
  Serial.println("#   serie <sensor> <segundos> [intervalo]  ex.: serie nivel 300 15  (Enter interrompe)");
  Serial.println("#   transiente <sensor>                    ex.: transiente solo");
  Serial.println("#   espera <ms>                            ex.: espera 500  (atual: " + String(g_settleMs) + " ms)");
  Serial.println("#   ajuda");
  Serial.println("# Sensores: nivel, chuva, solo");
}

// Separa "a b c" em ate 3 partes.
size_t splitArgs(String text, String parts[], size_t maxParts) {
  text.trim();
  size_t count = 0;
  while (text.length() > 0 && count < maxParts) {
    const int space = text.indexOf(' ');
    if (space < 0 || count == maxParts - 1) {
      parts[count++] = text;
      break;
    }
    parts[count++] = text.substring(0, space);
    text = text.substring(space + 1);
    text.trim();
  }
  return count;
}

void handleSeries(const String& rest) {
  String args[3];
  const size_t count = splitArgs(rest, args, 3);
  const Sensor* sensor = count >= 1 ? findSensor(args[0]) : nullptr;
  const long seconds = count >= 2 ? args[1].toInt() : 0;
  const long intervalS = count >= 3 ? args[2].toInt() : static_cast<long>(DEFAULT_SERIES_INTERVAL_S);
  if (sensor == nullptr || seconds <= 0 || intervalS <= 0) {
    Serial.println("# uso: serie <sensor> <segundos> [intervalo em s]");
    return;
  }
  measureSeries(*sensor, static_cast<uint32_t>(seconds), static_cast<uint32_t>(intervalS));
}

bool isUnsignedNumber(const String& text) {
  if (text.length() == 0) return false;
  for (unsigned i = 0; i < text.length(); ++i) {
    if (!isdigit(static_cast<unsigned char>(text.c_str()[i]))) return false;
  }
  return true;
}

void handleSettle(const String& rest) {
  const long ms = isUnsignedNumber(rest) ? rest.toInt() : -1;
  if (ms < 0 || ms > MAX_SETTLE_MS) {
    Serial.println("# uso: espera <ms>  (0 a 5000)");
    return;
  }
  g_settleMs = static_cast<uint16_t>(ms);
  Serial.printf("# espera ajustada para %u ms\n", static_cast<unsigned>(g_settleMs));
}

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  const int firstSpace = line.indexOf(' ');
  const String command = firstSpace < 0 ? line : line.substring(0, firstSpace);
  String rest = firstSpace < 0 ? String() : line.substring(firstSpace + 1);
  rest.trim();

  if (command.equalsIgnoreCase("ajuda")) {
    printHelp();
  } else if (command.equalsIgnoreCase("serie")) {
    handleSeries(rest);
  } else if (command.equalsIgnoreCase("espera")) {
    handleSettle(rest);
  } else if (command.equalsIgnoreCase("transiente")) {
    const Sensor* sensor = findSensor(rest);
    if (sensor == nullptr) {
      Serial.println("# uso: transiente <sensor>");
      return;
    }
    measureTransient(*sensor);
  } else {
    const Sensor* sensor = findSensor(command);
    if (sensor == nullptr) {
      Serial.println("# comando desconhecido; digite ajuda");
      return;
    }
    measurePoint(*sensor, sanitizeReference(rest));
  }
}

}  // namespace

void setup() {
  Serial.begin(BAUD);
  Serial.setTimeout(50);

  for (const Sensor& sensor : SENSORS) {
    if (isSwitched(sensor)) {
      pinMode(sensor.powerPin, OUTPUT);
      digitalWrite(sensor.powerPin, LOW);
    }
  }

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // faixa completa; mais precisa entre ~150 e ~2450 mV
  delay(CAPACITIVE_WARMUP_MS);

  printHelp();
  Serial.println("millis,sensor,referencia,leitura,mv,raw");
}

void loop() {
  if (Serial.available()) {
    handleCommand(Serial.readStringUntil('\n'));
  }
}
