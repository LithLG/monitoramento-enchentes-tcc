# Protótipo de monitoramento de enchentes e alerta preventivo baseado em inteligência artificial

Prova de Conceito de Internet das Coisas desenvolvida como Trabalho de Conclusão de Curso.

[Ler o artigo final (PDF, 33 páginas)](docs/artigo-final.pdf) · [Consultar os dados dos ensaios](#dados-dos-ensaios)

## Apresentação para a banca

O painel pode reproduzir os ensaios no notebook sem internet e com os ESP32 desligados. A [cópia do MySQL para a banca](banco/historico-banca.zip) contém 97.790 leituras gravadas de 6 de outubro a 1º de novembro de 2026, 92.272 classificações, 15 calibrações, dois conjuntos de limiares e uma conferência com régua. Os TSVs no fim deste README são recortes para análise.

### Preparar o notebook uma vez

1. No Windows, instale o MySQL Server 8.4, configure o serviço para iniciar com o Windows e guarde a senha de root. Instale o Node.js 20.6 ou superior com npm. Use o fuso de Brasília para ver os mesmos horários do artigo.
2. Copie ou extraia o projeto em `C:\TCC` (o README deve estar em `C:\TCC\README.md`). Extraia `banco\historico-banca.zip` para obter `C:\TCC\banco\historico.sql`. Ajuste os caminhos abaixo se usar outra pasta.
3. Abra o **MySQL 8.4 Command Line Client** como root. Execute as linhas abaixo, uma de cada vez, em uma instalação nova. Escolha uma senha própria para o usuário de leitura. Se o banco `tcc_banca` já existir, confira a contagem antes de importar novamente. O script `criar_banco.sql` da instalação ao vivo apaga e recria o banco operacional e é dispensável para esta apresentação.

   ```sql
   CREATE DATABASE tcc_banca CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   USE tcc_banca;
   source C:/TCC/banco/historico.sql
   SELECT COUNT(*) FROM reading;
   CREATE USER 'banca_leitura'@'localhost' IDENTIFIED BY 'SUA_SENHA_AQUI';
   GRANT SELECT ON tcc_banca.* TO 'banca_leitura'@'localhost';
   ```

4. A consulta deve retornar **97790**. Em um PowerShell, instale as dependências e crie a configuração da apresentação:

   ```powershell
   cd C:\TCC\servidor
   npm.cmd ci
   notepad .env.banca
   ```

   Confirme a criação do arquivo e salve nele estas linhas, usando a senha do passo 3:

   ```dotenv
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_PASSWORD="SUA_SENHA_AQUI"
   ```

### No dia da apresentação

Dê dois cliques em **`apresentar_banca.bat`** na pasta do projeto. Ele abre a caixa 2 no período de **01/11/2026, das 18h19 às 18h24**. Em **Histórico**, clique em **Replay**. Às **18h21min08s**, a regra `ESCALADA_SOLO_CHUVA` registrou Risco com lâmina de 15,9 mm, chuva e solo encharcado. O trecho tem 20 leituras, 11 em Atenção e 9 em Risco. A indicação de sensor sem sinal no modo ao vivo é esperada com a maquete desligada.

Para explorar outro ensaio, abra a caixa desejada e use **Histórico → Escolher… → De / Até → Aplicar**. O gráfico e a linha do tempo mostram o período escolhido. Feche a janela do servidor ao terminar. O usuário da banca tem acesso de leitura. Para fazer novas medições, siga a instalação do sistema ao vivo abaixo.

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
3. O classificador aplica a árvore de decisão com o conjunto de limiares ativo. O servidor grava a classe e a regra que determinou o resultado.
4. O painel mostra o nível de cada ponto, os alertas, o histórico, o simulador da árvore e a entrega das leituras.

## Estrutura

| Pasta ou arquivo | Conteúdo |
|---|---|
| `no_sensor/` | Firmware dos nós (ESP32 + sensores de nível, chuva e solo) |
| `calibracao_bancada/` | Firmware de bancada usado para calibrar os sensores (imprime CSV na serial) |
| `servidor/` | Servidor Node.js (Express) e painel web (HTML, CSS, JavaScript e Chart.js) |
| `classificador/` | Serviço Python (FastAPI) com a árvore de decisão |
| `banco/` | Script SQL único que cria o banco: estrutura, locais, calibrações, limiares e usuário do programa |
| `calibracao_dados/` | Leituras dos ensaios de 24 a 28 de outubro e de 1º de novembro de 2026, em TSV |
| `docs/` | Artigo final do TCC em PDF |
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

cd ..\classificador
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

Os horários abaixo seguem o horário de Brasília. Os dois arquivos usam colunas separadas por tabulação e representam valores ausentes com `NULL`.

- **24 a 28 de outubro de 2026.** O arquivo consolidado reúne 53.292 leituras dos três nós, de 24/10 às 14h35 a 28/10 às 08h05. [Baixar dados de outubro](calibracao_dados/leituras_2026-10-24_a_2026-10-28.tsv).
- **1º de novembro de 2026.** A exportação reúne 873 leituras dos três nós, das 17h35 às 18h48. O artigo analisa 137 leituras da caixa 2 no ensaio que combinou chuva e solo encharcado, com a lâmina na faixa de Atenção. Quando os dois estímulos ocorreram juntos, o sistema indicou Risco nas cinco repetições. [Baixar dados de novembro](calibracao_dados/leituras_2026-11-01_1848.tsv).

Para reproduzir a conversão de tensão em nível, observe a data da calibração. O script de instalação do banco contém o ajuste de outubro da caixa 2 (−79 mV em relação à curva original). O artigo registra um novo ajuste de cerca de +130 mV em 1º de novembro. A coluna `level_depth_mm` preserva o valor calculado no momento de cada leitura.

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

Guarde a senha do banco em `servidor/.env` e a do Wi-Fi em `no_sensor/config.h`. O Git ignora esses dois arquivos. Os modelos para configurar outra instalação estão em [env-exemplo.txt](servidor/env-exemplo.txt) e [config.exemplo.h](no_sensor/config.exemplo.h).
