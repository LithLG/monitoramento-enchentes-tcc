// config.exemplo.h — copie este arquivo para config.h (mesma pasta) e edite antes de enviar para cada ESP32.
// O config.h guarda a senha do Wi-Fi e fica fora do repositório (.gitignore).
// Este arquivo aparece como uma aba ao lado de no_sensor.ino na Arduino IDE.
#pragma once
#include <stdint.h>

// Rede Wi-Fi de 2,4 GHz (o ESP32 nao conecta em 5 GHz nem em rede com login por pagina web).
constexpr char WIFI_SSID[] = "NOME_DA_REDE";
constexpr char WIFI_PASSWORD[] = "SENHA_DA_REDE";

// Endereco do servidor: IP do PC (ipconfig -> "Endereco IPv4") + porta 3000.
// O servidor mostra este endereco pronto quando e iniciado.
constexpr char SERVER_URL[] = "http://192.168.0.10:3000/readings";

// Numero da caixa: 1, 2 ou 3. DIFERENTE em cada ESP32.
constexpr uint8_t NODE_ID = 1;
