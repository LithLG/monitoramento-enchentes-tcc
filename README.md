# Protótipo de monitoramento de enchentes e prevenção usando inteligência artificial

Prova de Conceito de Internet das Coisas desenvolvida como Trabalho de Conclusão de Curso.

Uma maquete representa três pontos de um mesmo rio, nas zonas rural, periurbana e urbana. Em cada ponto, um ESP32 lê sensores de baixo custo de nível da água, chuva e umidade do solo a cada 15 s e envia as leituras por Wi-Fi a um servidor. As leituras são gravadas em MySQL e classificadas em **Normal**, **Atenção** ou **Risco** por uma árvore de decisão com regras definidas por conhecimento técnico (sistema especialista), em Python. Um painel web mostra os dados, os alertas e o caminho da decisão.

**Autores:** Letícia de Freitas Barros e Lucas Gabriel dos Santos Moraes
**Orientador:** Prof. Carlos Henrique Loureiro Feichas
**Coorientador:** Prof. Paulo Gustavo Borba Cordaro

## Arquitetura

```
3 nós ESP32 ──HTTP POST (JSON)──> Servidor Node.js ──> MySQL 8.4
                                       │   ▲
                                       ▼   │
                              Classificador Python (FastAPI)

Painel web (navegador) <── Servidor Node.js
```

1. O ESP32 envia as tensões dos sensores (`POST /readings`).
2. O servidor valida a leitura, converte as tensões em nível (mm), índice de solo e chuva com a calibração ativa de cada nó e grava no banco.
3. O classificador aplica a árvore de decisão com o conjunto de limiares ativo e grava a classe.
4. O painel mostra o nível de cada ponto, os alertas, o histórico, o simulador da árvore e a entrega das leituras.

## Estrutura

| Pasta ou arquivo | Conteúdo |
|---|---|
| `no_sensor/` | Firmware dos nós (ESP32 + sensores de nível, chuva e solo) |
| `calibracao_bancada/` | Firmware de bancada usado para calibrar os sensores (imprime CSV na serial) |
| `servidor/` | Servidor Node.js (Express) e painel web (HTML, CSS, JavaScript e Chart.js) |
| `classificador/` | Serviço Python (FastAPI) com a árvore de decisão |
| `banco/` | Script SQL único que cria o banco: estrutura, locais, calibrações, limiares e usuário do programa |
| `calibracao_dados/` | Todas as leituras dos ensaios, de 24 a 28/10/2026, em um único arquivo (`.tsv`) |
| `iniciar_sistema.bat` | Liga o classificador e o servidor e abre o painel (Windows) |
| `exportar_leituras.bat` | Exporta as leituras do banco para `calibracao_dados/` |

## Hardware de cada nó

ESP32 DevKitC V4 (WROOM-32E), alimentado pela USB. Todos os sensores em **3,3 V** (nunca 5 V).

| Sensor | Mede | Sinal | Alimentação |
|---|---|---|---|
| Capacitivo v2.0 | Nível do rio | GPIO32 | 3V3 contínuo |
| FC-37 | Chuva | GPIO35 | GPIO26 (ligado só na leitura) |
| FD10, em um copo com terra | Umidade do solo | GPIO34 | GPIO25 (ligado só na leitura) |

## Requisitos

- Windows 10 ou 11 (para os arquivos `.bat`)
- MySQL 8.4 (serviço `MySQL84`)
- Node.js 20.6 ou superior
- Python 3 (testado com 3.14)
- Arduino IDE com o pacote de placas **esp32** (Espressif)

## Como instalar e rodar

### 1. Banco de dados

1. Abra o `banco/criar_banco.sql` e troque `TROQUE_ESTA_SENHA` (no fim do arquivo) por uma senha sua.
2. No **MySQL 8.4 Command Line Client** (usuário root), rode:

```
source C:/caminho/do/repositorio/banco/criar_banco.sql
```

O script cria o banco `tcc_enchentes` com a estrutura final, os três locais da maquete, as calibrações e os limiares usados nos ensaios (v1 inativa, para comparação, e v2 ativa) e o usuário `tcc_app`, que o servidor e o classificador usam. **Atenção:** se o banco já existir, ele é apagado e criado de novo.

### 2. Servidor e painel (Node.js)

```
cd servidor
copy env-exemplo.txt .env
npm install
```

No `.env`, preencha `DB_PASSWORD` com a senha escolhida no passo 1.

### 3. Classificador (Python)

```
cd classificador
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

O classificador usa o mesmo `servidor/.env`, então a senha fica em um lugar só.

### 4. Ligar o sistema

Dê dois cliques em `iniciar_sistema.bat`. Ele liga o classificador (porta 8000) e o servidor (porta 3000) e abre o painel em `http://localhost:3000`.

### 5. Nós ESP32

1. Em `no_sensor/`, copie `config.exemplo.h` para `config.h`.
2. No `config.h`, preencha o nome e a senha da rede Wi-Fi (2,4 GHz), o endereço do servidor (ele aparece na tela quando o servidor é iniciado) e o número da caixa (`NODE_ID` = 1, 2 ou 3).
3. Na Arduino IDE, escolha a placa **ESP32 Dev Module** e grave o `no_sensor.ino` em cada ESP32, mudando só o `NODE_ID`.

### Testes automatizados

```
cd servidor
npm test

cd classificador
.venv\Scripts\python -m pytest
```

### Exportar as leituras

`exportar_leituras.bat` salva as leituras do banco em `calibracao_dados/leituras_AAAA-MM-DD_HHMM.tsv`.

## Regras de classificação (limiares v2)

| Classe | Entra quando | Sai quando |
|---|---|---|
| Atenção | lâmina ≥ 16,5 mm | lâmina < 14,5 mm |
| Risco | lâmina ≥ 21,0 mm, ou água acima da margem (25,5 mm), ou Atenção com chuva e solo encharcado | lâmina < 19,0 mm |

A diferença de 2 mm entre entrar e sair (histerese) evita que o alerta fique ligando e desligando quando o nível oscila perto de um limite. A árvore completa está em `classificador/app/tree.py`.

## Dados dos ensaios

`calibracao_dados/leituras_2026-10-24_a_2026-10-28.tsv` reúne as 53.292 leituras dos três nós, de 24/10/2026 às 14h35 a 28/10/2026 às 08h05 (horário de Brasília), juntando as exportações feitas durante os ensaios. Colunas separadas por tabulação; `NULL` = sem valor.

| Coluna | Significado |
|---|---|
| `id` | Número da leitura no banco |
| `node_id` | Caixa: 1 (urbana), 2 (periurbana) ou 3 (rural) |
| `seq` | Contador de envios do ESP32 (recomeça quando ele reinicia) |
| `uptime_ms` | Tempo desde que o ESP32 ligou (ms) |
| `recorded_at` | Data e hora em que a leitura chegou ao servidor |
| `level_mv`, `rain_mv`, `soil_mv` | Tensões dos sensores de nível, chuva e solo (mV) |
| `level_range` | Nível `ABAIXO`, `DENTRO` ou `ACIMA` da faixa do sensor |
| `level_depth_mm` | Lâmina d'água acima do leito (mm); só existe quando `DENTRO` |
| `rain_class` | `SECO` ou `CHUVA` |
| `soil_index` | Índice de umidade do solo S (0 = seco; a partir de 0,8 = encharcado) |
| `status` | Classe: `NORMAL`, `ATENCAO` ou `RISCO` |
| `rule` | Regra da árvore que decidiu a classe |

- As leituras de 24/10 até as 22h10 não têm valores convertidos nem classe, porque os sensores ainda não estavam calibrados.
- A classe é a gravada na hora, com os limiares ativos naquele momento: v1 até 26/10, por volta das 05h10, e v2 depois.

## Senhas

O `servidor/.env` (senha do banco) e o `no_sensor/config.h` (senha do Wi-Fi)
