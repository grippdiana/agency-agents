# Guia de Integrações — Samsung Crystal 55" + Tuya + LG ThinQ

O **HOLONET // Comando Residencial** suporta controle nativo da sua **TV Samsung Crystal 55" Smart (Tizen OS)** pelo Wi-Fi local, além de **Home Assistant** e **Tuya Cloud OpenAPI v2.0**.

---

## 1. TV Samsung Crystal 55" Smart (Tizen OS — Wi-Fi Direto, Sem Hub!) ★

As TVs Samsung Crystal UHD rodam **Tizen OS** e expõem dois canais oficiais na sua rede Wi-Fi doméstica:
- **Porta `8002` (WSS TLS com certificado autoassinado):** canal de controle remoto `samsung.remote.control` (`KEY_POWER`, `KEY_VOLUP`, `KEY_VOLDOWN`, `KEY_MUTE`, `KEY_HOME`, setas, `KEY_HDMI`, etc.). O HOLONET já aceita o certificado autoassinado da TV automaticamente e salva o **Token de 8 dígitos** após a 1ª confirmação!
- **Porta `8001` (API REST v2):** permite descobrir o modelo exato, ler o **MAC Wi-Fi automaticamente** (para ligar a TV via **Wake-on-LAN**) e abrir apps como **Netflix (`3201907018807`)**, **YouTube (`111299001912`)**, **Prime Video (`3201910019365`)**, **Disney+ (`3201901017640`)** e **Spotify (`3201606009684`)** em 1 clique!

### Passo a passo para parear sua Samsung Crystal 55"
1. Ligue a TV com o controle remoto e garanta que ela esteja no mesmo Wi-Fi do seu computador.
2. Veja o IP da TV em: **Configurações → Geral → Rede → Status da Rede → Config. IP** *(ou clique na aba **◎ Sensores Wi-Fi → Iniciar Varredura de Setor** no HOLONET instalado — ele acha a Samsung sozinho!)*.
3. Na TV, verifique se a opção **Configurações → Geral → Gerenciador de Dispositivos Externos → Gerenciador de Conexão de Dispositivos → Notificação de Acesso** está em **Apenas Primeira Vez**.
4. No HOLONET, abra **⬡ Parear Casa** → cartão **Samsung Crystal 55" Smart**:
   - Digite o **IP da TV** (ex: `192.168.1.51`).
   - Clique em **⌖ Parear Samsung 55"**.
5. **Olhe para o canto superior direito da TV:** vai aparecer *"HOLONET Command deseja conectar"* → aperte **Permitir** usando o controle remoto da Samsung!
6. Pronto! O token e o MAC Wi-Fi ficam gravados em `config.json`. Para ligar a TV quando ela estiver desligada, ative na TV *Configurações → Geral → Rede → Configurações Especializadas → Ligar com Dispositivo Móvel* (habilita o Wake-on-LAN pelo Wi-Fi!).

---

## 2. Home Assistant — Unificador para Luzes Tuya + Lava e Seca LG ThinQ ★

Para juntar suas **lâmpadas/tomadas Tuya** e sua **máquina de lavar LG ThinQ** localmente:

1. Suba o Home Assistant na sua casa (em Docker no seu PC ou Raspberry Pi):
   ```bash
   docker run -d --name homeassistant --restart=unless-stopped -p 8123:8123 -v ~/homeassistant:/config ghcr.io/home-assistant/home-assistant:stable
   ```
2. Em *Configurações → Dispositivos e Serviços*, adicione:
   - **Tuya** (escaneando o QR Code no app Tuya / Smart Life do celular)
   - **LG ThinQ** (usando o *Personal Access Token* gratuito gerado em `thinq.developer.lge.com`)
   - *(Opcional)* **Samsung Smart TV**
3. No seu Perfil do Home Assistant → aba **Segurança** → crie um **Token de acesso de longa duração**.
4. No HOLONET → **⬡ Parear Casa** → cole `http://IP_DO_HA:8123` e o Token → clique em **Salvar & Sincronizar**.

---

## 3. Tuya / Smart Life Cloud Direto (OpenAPI v2.0 HMAC-SHA256)

Se quiser controlar suas luzes e tomadas Tuya sem instalar Home Assistant:
1. Crie uma conta em **[iot.tuya.com](https://iot.tuya.com)** → **Cloud → Create Project** (*Smart Home*, Data Center **Western America** `https://openapi.tuyaus.com`).
2. Em **Devices → Link Tuya App Account**, escaneie o QR Code com o app **Smart Life / Tuya** no celular.
3. Cole o **Access ID** e o **Access Secret** no cartão **Tuya** do HOLONET, clique em **Gravar Chave Tuya**, e em cada lâmpada clique em **⚙ Vincular** para informar o `Device ID`.
