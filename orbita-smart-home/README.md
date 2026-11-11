# ORBITA — Casa Inteligente // Desktop & Wi-Fi Dashboard

Dashboard desktop futurista (estética **HUD Orbital Arquitetônico** — carbono `#080A0B`, osso `#E8E6DF`, lima-ácido `#C8FF2E` e sinal `#FF4D24`) para controlar dispositivos na sua rede Wi-Fi local:

- **Lâmpadas, fitas LED, tomadas, fechadura e sensores Tuya / Smart Life**
- **Lava e Seca, Geladeira e Ar-condicionado LG ThinQ**
- **Smart TV LG webOS** direto pela rede Wi-Fi (WebSocket SSAP porta `3000` + Wake-on-LAN UDP)
- **Home Assistant** como hub local unificado (sincronização automática de entidades e envio de comandos REST)

---

## Como rodar como Aplicativo Desktop no seu PC

> **Por que instalar no seu PC?** Aparelhos inteligentes ficam na sua rede Wi-Fi privada (`192.168.x.x`). Rodando o ORBITA Desktop na sua máquina, ele enxerga sua TV LG, seu Home Assistant e seus dispositivos Tuya diretamente pela rede local.

### Pré-requisito
- [Node.js 18 LTS ou superior](https://nodejs.org)

### Opção rápida (1 clique)
- **Windows:** dê dois cliques em `Instalar-Windows.bat`
- **macOS / Linux:** rode `./instalar-mac-linux.sh`

### Opção via Terminal
```bash
cd orbita-smart-home
npm install

# Abrir a janela nativa Desktop (Electron + bandeja do sistema)
npm run desktop

# Ou rodar apenas o servidor web local na porta 3000 (acessível também pelo celular no Wi-Fi)
npm start
```

### Gerar o instalador definitivo (`.exe`, `.dmg`, `.AppImage`, `.deb`)
```bash
npm run build:win     # Gera instalador Windows NSIS + versão Portable em dist/
npm run build:mac     # Gera imagem .dmg para macOS em dist/
npm run build:linux   # Gera .AppImage e .deb para Linux em dist/
```

---

## Qual integração utilizar na sua casa?

1. **TV LG webOS (Direto pelo Wi-Fi, sem hub extra):**
   - Na TV: *Configurações → Geral → Dispositivos Externos → LG Connect Apps → Ativar* (e *Ligar TV via Wi-Fi* para Wake-on-LAN).
   - No ORBITA: aba **Conectar Casa** → cartão **TV LG webOS** → informe o IP e MAC da TV → clique em **Parear TV na Rede** e aceite na tela da TV com o controle remoto.

2. **Tuya + LG ThinQ juntos (Caminho Recomendado ★ — Home Assistant):**
   - Suba o Home Assistant na sua rede (Docker no próprio PC, mini-PC ou Raspberry Pi).
   - Adicione as integrações **Tuya / Tuya Local** e **LG ThinQ** (ou *SmartThinQ LGE Sensors* via HACS).
   - Gere um *Token de Acesso de Longa Duração* no perfil do Home Assistant, cole no ORBITA e clique em **Salvar & Sincronizar**.

3. **Tuya Cloud IoT Direto (OpenAPI v2.0 HMAC-SHA256):**
   - Crie um projeto *Smart Home* gratuito em [iot.tuya.com](https://iot.tuya.com), vincule o QR Code do app Smart Life/Tuya em *Link Tuya App Account*, cole *Access ID* e *Access Secret* no ORBITA e vincule o `Device ID` em cada aparelho.

Veja o guia detalhado em [`docs/integracoes.md`](docs/integracoes.md).

---

## Testes automatizados

```bash
npm test
```
Testa modo Demo, comandos de dispositivos, pareamento/comandos simulados de Home Assistant e Tuya OpenAPI v2.0, Wake-on-LAN UDP e geração do pacote instalável.
