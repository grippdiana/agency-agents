/**
 * HOLONET-Desktop.exe — Programa Desktop Nativo Standalone (Windows 10 / 11)
 * Zero dependências externas (não requer Node.js, Python ou terminal).
 *
 * Recursos ao abrir com 2 cliques:
 *  1) Instala-se automaticamente em %LOCALAPPDATA%\HOLONET\HOLONET-Desktop.exe
 *  2) Cria atalho "HOLONET Comando" na Área de Trabalho e no Menu Iniciar
 *  3) Ativa inicialização automática junto com o Windows (HKCU\...\CurrentVersion\Run)
 *  4) Fica residente na Bandeja do Sistema (perto do relógio) com menu de botão direito
 *  5) Abre a janela desktop sem bordas (Edge/Chrome --app) + servidor local Wi-Fi (porta 3077):
 *     - TV Samsung Crystal 55" Tizen OS: WSS porta 8002 (certificado autoassinado aceito via WinHTTP),
 *       descoberta automática de modelo/MAC via porta 8001, abertura direta de Netflix/YouTube/Prime/Disney+
 *       e Wake-on-LAN UDP Magic Packet
 *     - Home Assistant REST API (teste, sync básico e disparo de serviços)
 *     - Tuya Cloud OpenAPI v2.0 (SHA-256 + HMAC-SHA256 nativo em C)
 *     - Scanner Wi-Fi paralelo na sub-rede local
 */
#ifdef _WIN32
#define FD_SETSIZE 512
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winhttp.h>
#include <shellapi.h>
#include <shlobj.h>
#include <objbase.h>
#include <process.h>
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <pthread.h>
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <math.h>

#include "embed_assets.h"

#define HOLONET_DEFAULT_PORT 3077
#define MAX_DEVICES 32
#define MAX_LOGS 40

/* =========================================================================
 * SHA-256 & HMAC-SHA256 Portátil (para Tuya OpenAPI v2.0)
 * ========================================================================= */
typedef struct {
    uint8_t data[64];
    uint32_t datalen;
    uint64_t bitlen;
    uint32_t state[8];
} Sha256Ctx;

static const uint32_t K256[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

#define ROR32(a,b) (((a) >> (b)) | ((a) << (32-(b))))

static void sha256_transform(Sha256Ctx *ctx, const uint8_t data[]) {
    uint32_t a,b,c,d,e,f,g,h,i,j,t1,t2,m[64];
    for (i = 0, j = 0; i < 16; ++i, j += 4)
        m[i] = ((uint32_t)data[j] << 24) | ((uint32_t)data[j+1] << 16) | ((uint32_t)data[j+2] << 8) | data[j+3];
    for (; i < 64; ++i) {
        uint32_t s0 = ROR32(m[i-15],7) ^ ROR32(m[i-15],18) ^ (m[i-15] >> 3);
        uint32_t s1 = ROR32(m[i-2],17) ^ ROR32(m[i-2],19) ^ (m[i-2] >> 10);
        m[i] = m[i-16] + s0 + m[i-7] + s1;
    }
    a=ctx->state[0]; b=ctx->state[1]; c=ctx->state[2]; d=ctx->state[3];
    e=ctx->state[4]; f=ctx->state[5]; g=ctx->state[6]; h=ctx->state[7];
    for (i = 0; i < 64; ++i) {
        t1 = h + (ROR32(e,6)^ROR32(e,11)^ROR32(e,25)) + ((e&f)^((~e)&g)) + K256[i] + m[i];
        t2 = (ROR32(a,2)^ROR32(a,13)^ROR32(a,22)) + ((a&b)^(a&c)^(b&c));
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    ctx->state[0]+=a; ctx->state[1]+=b; ctx->state[2]+=c; ctx->state[3]+=d;
    ctx->state[4]+=e; ctx->state[5]+=f; ctx->state[6]+=g; ctx->state[7]+=h;
}

static void sha256_init(Sha256Ctx *ctx) {
    ctx->datalen = 0; ctx->bitlen = 0;
    ctx->state[0]=0x6a09e667; ctx->state[1]=0xbb67ae85; ctx->state[2]=0x3c6ef372; ctx->state[3]=0xa54ff53a;
    ctx->state[4]=0x510e527f; ctx->state[5]=0x9b05688c; ctx->state[6]=0x1f83d9ab; ctx->state[7]=0x5be0cd19;
}

static void sha256_update(Sha256Ctx *ctx, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; ++i) {
        ctx->data[ctx->datalen++] = data[i];
        if (ctx->datalen == 64) {
            sha256_transform(ctx, ctx->data);
            ctx->bitlen += 512;
            ctx->datalen = 0;
        }
    }
}

static void sha256_final(Sha256Ctx *ctx, uint8_t hash[32]) {
    uint32_t i = ctx->datalen;
    if (ctx->datalen < 56) {
        ctx->data[i++] = 0x80;
        while (i < 56) ctx->data[i++] = 0x00;
    } else {
        ctx->data[i++] = 0x80;
        while (i < 64) ctx->data[i++] = 0x00;
        sha256_transform(ctx, ctx->data);
        memset(ctx->data, 0, 56);
    }
    ctx->bitlen += (uint64_t)ctx->datalen * 8;
    for (int k = 0; k < 8; k++) ctx->data[63 - k] = (uint8_t)(ctx->bitlen >> (k * 8));
    sha256_transform(ctx, ctx->data);
    for (i = 0; i < 4; ++i) {
        for (int s = 0; s < 8; s++) hash[i + s*4] = (ctx->state[s] >> (24 - i*8)) & 0xff;
    }
}

static void sha256_hex(const char *str, char out_hex[65], bool upper) {
    uint8_t h[32];
    Sha256Ctx c;
    sha256_init(&c);
    sha256_update(&c, (const uint8_t*)str, strlen(str));
    sha256_final(&c, h);
    const char *fmt = upper ? "%02X" : "%02x";
    for (int i = 0; i < 32; i++) snprintf(out_hex + i*2, 3, fmt, h[i]);
    out_hex[64] = '\0';
}

static void hmac_sha256_hex(const char *key, const char *msg, char out_hex[65]) {
    uint8_t k_ipad[64], k_opad[64], tk[32], inner[32], outer[32];
    size_t klen = strlen(key);
    if (klen > 64) {
        Sha256Ctx c; sha256_init(&c); sha256_update(&c, (const uint8_t*)key, klen); sha256_final(&c, tk);
        key = (const char*)tk; klen = 32;
    }
    memset(k_ipad, 0x36, 64); memset(k_opad, 0x5c, 64);
    for (size_t i = 0; i < klen; i++) { k_ipad[i] ^= (uint8_t)key[i]; k_opad[i] ^= (uint8_t)key[i]; }
    Sha256Ctx ci, co;
    sha256_init(&ci); sha256_update(&ci, k_ipad, 64); sha256_update(&ci, (const uint8_t*)msg, strlen(msg)); sha256_final(&ci, inner);
    sha256_init(&co); sha256_update(&co, k_opad, 64); sha256_update(&co, inner, 32); sha256_final(&co, outer);
    for (int i = 0; i < 32; i++) snprintf(out_hex + i*2, 3, "%02X", outer[i]);
    out_hex[64] = '\0';
}

/* =========================================================================
 * Estado Global e Utilitários JSON
 * ========================================================================= */
typedef struct {
    char id[64];
    char name[96];
    char type[24];
    char brand[48];
    char room[48];
    char ip[64];
    char mac[32];
    char haEntity[80];
    char tuyaId[80];
    bool online;
    bool power;
    int brightness;
    int colorTemp;
    char color[16];
    int volume;
    bool muted;
    char input[32];
    char status[32];
    int progress;
    char cycle[48];
    double temp;
    int remainMin;
    char mode[24];
    char fan[24];
    int fridgeTemp;
    int freezerTemp;
    bool locked;
    int battery;
    bool recording;
    int watts;
    int humidity;
    int x;
    int y;
} Device;

typedef struct {
    char id[24];
    char name[48];
    char icon[12];
    char code[16];
    char desc[128];
    bool active;
} Scene;

typedef struct {
    char time[32];
    char text[220];
} LogEntry;

typedef struct {
    char mode[24];
    bool autostart;
    char samsungTvIp[64];
    char samsungTvMac[32];
    char samsungTvToken[64];
    bool samsungTvPaired;
    char haUrl[128];
    char haToken[256];
    char tuyaClientId[96];
    char tuyaSecret[96];
    char tuyaEndpoint[128];
} AppConfig;

static Device g_devices[MAX_DEVICES];
static int g_device_count = 0;
static Scene g_scenes[5];
static LogEntry g_logs[MAX_LOGS];
static int g_log_count = 0;
static AppConfig g_cfg;
static char g_data_dir[512] = ".";
static int g_server_port = HOLONET_DEFAULT_PORT;

#ifdef _WIN32
static CRITICAL_SECTION g_lock;
static void lock_state(void) { EnterCriticalSection(&g_lock); }
static void unlock_state(void) { LeaveCriticalSection(&g_lock); }
#else
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static void lock_state(void) { pthread_mutex_lock(&g_lock); }
static void unlock_state(void) { pthread_mutex_unlock(&g_lock); }
#endif

static void iso_now(char out[32]) {
    time_t t = time(NULL);
    struct tm *tm_info = gmtime(&t);
    strftime(out, 32, "%Y-%m-%dT%H:%M:%SZ", tm_info);
}

static void add_log(const char *txt) {
    if (g_log_count >= MAX_LOGS) {
        memmove(&g_logs[1], &g_logs[0], sizeof(LogEntry) * (MAX_LOGS - 1));
        g_log_count = MAX_LOGS - 1;
    } else if (g_log_count > 0) {
        memmove(&g_logs[1], &g_logs[0], sizeof(LogEntry) * g_log_count);
    }
    iso_now(g_logs[0].time);
    snprintf(g_logs[0].text, sizeof(g_logs[0].text), "%s", txt);
    g_log_count++;
}

static void json_escape(const char *src, char *dst, size_t max_len) {
    size_t j = 0;
    for (size_t i = 0; src && src[i] && j + 6 < max_len; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c == '"' || c == '\\') { dst[j++] = '\\'; dst[j++] = (char)c; }
        else if (c == '\n') { dst[j++] = '\\'; dst[j++] = 'n'; }
        else if (c == '\r') { dst[j++] = '\\'; dst[j++] = 'r'; }
        else if (c == '\t') { dst[j++] = '\\'; dst[j++] = 't'; }
        else if (c >= 0x20) { dst[j++] = (char)c; }
    }
    dst[j] = '\0';
}

static bool json_get_string(const char *json, const char *key, char *out, size_t out_sz) {
    if (!json || !key || !out || out_sz == 0) return false;
    char pat[96];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return false;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p != ':') return false;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p != '"') return false;
    p++;
    size_t j = 0;
    while (*p && *p != '"' && j + 1 < out_sz) {
        if (*p == '\\' && *(p+1)) {
            p++;
            if (*p == 'n') out[j++] = '\n';
            else if (*p == 't') out[j++] = '\t';
            else out[j++] = *p;
        } else {
            out[j++] = *p;
        }
        p++;
    }
    out[j] = '\0';
    return true;
}

static bool json_get_number(const char *json, const char *key, double *out) {
    if (!json || !key) return false;
    char pat[96];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return false;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p != ':') return false;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p == '"') p++;
    char *endp = NULL;
    double v = strtod(p, &endp);
    if (endp == p) return false;
    *out = v;
    return true;
}

static bool json_get_bool(const char *json, const char *key, bool *out) {
    if (!json || !key) return false;
    char pat[96];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return false;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == ':') p++;
    if (strncmp(p, "true", 4) == 0) { *out = true; return true; }
    if (strncmp(p, "false", 5) == 0) { *out = false; return true; }
    return false;
}

static int clamp_int(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* =========================================================================
 * Persistência config.json + Inicialização Automática no Windows
 * ========================================================================= */
#ifdef _WIN32
static bool win_get_autostart_registry(void) {
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_READ, &hKey) != ERROR_SUCCESS)
        return false;
    wchar_t buf[512];
    DWORD sz = sizeof(buf);
    LONG r = RegQueryValueExW(hKey, L"HOLONET", NULL, NULL, (LPBYTE)buf, &sz);
    RegCloseKey(hKey);
    return (r == ERROR_SUCCESS);
}

static bool win_set_autostart_registry(bool enable) {
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) != ERROR_SUCCESS)
        return false;
    LONG r;
    if (enable) {
        wchar_t exePath[MAX_PATH];
        GetModuleFileNameW(NULL, exePath, MAX_PATH);
        wchar_t cmd[MAX_PATH + 32];
        wsprintfW(cmd, L"\"%s\" --autostart", exePath);
        r = RegSetValueExW(hKey, L"HOLONET", 0, REG_SZ, (const BYTE*)cmd, (DWORD)((wcslen(cmd) + 1) * sizeof(wchar_t)));
    } else {
        r = RegDeleteValueW(hKey, L"HOLONET");
    }
    RegCloseKey(hKey);
    return (r == ERROR_SUCCESS || (!enable && r == ERROR_FILE_NOT_FOUND));
}
#endif

static void save_config(void) {
    char path[600];
    snprintf(path, sizeof(path), "%s/config.json", g_data_dir);
    FILE *f = fopen(path, "wb");
    if (!f) return;
    char eHaUrl[256], eHaTok[512], eTuyaId[192], eTuyaSec[192], eTuyaEp[256], eSamIp[128], eSamMac[64], eSamTok[128];
    json_escape(g_cfg.haUrl, eHaUrl, sizeof(eHaUrl));
    json_escape(g_cfg.haToken, eHaTok, sizeof(eHaTok));
    json_escape(g_cfg.tuyaClientId, eTuyaId, sizeof(eTuyaId));
    json_escape(g_cfg.tuyaSecret, eTuyaSec, sizeof(eTuyaSec));
    json_escape(g_cfg.tuyaEndpoint, eTuyaEp, sizeof(eTuyaEp));
    json_escape(g_cfg.samsungTvIp, eSamIp, sizeof(eSamIp));
    json_escape(g_cfg.samsungTvMac, eSamMac, sizeof(eSamMac));
    json_escape(g_cfg.samsungTvToken, eSamTok, sizeof(eSamTok));
    fprintf(f,
        "{\n"
        "  \"mode\": \"%s\",\n"
        "  \"autostart\": %s,\n"
        "  \"samsungTvIp\": \"%s\",\n"
        "  \"samsungTvMac\": \"%s\",\n"
        "  \"samsungTvToken\": \"%s\",\n"
        "  \"samsungTvPaired\": %s,\n"
        "  \"haUrl\": \"%s\",\n"
        "  \"haToken\": \"%s\",\n"
        "  \"tuyaClientId\": \"%s\",\n"
        "  \"tuyaSecret\": \"%s\",\n"
        "  \"tuyaEndpoint\": \"%s\"\n"
        "}\n",
        g_cfg.mode,
        g_cfg.autostart ? "true" : "false",
        eSamIp, eSamMac, eSamTok,
        g_cfg.samsungTvPaired ? "true" : "false",
        eHaUrl, eHaTok, eTuyaId, eTuyaSec, eTuyaEp
    );
    fclose(f);
}

static void load_config(void) {
    memset(&g_cfg, 0, sizeof(g_cfg));
    strcpy(g_cfg.mode, "demo");
    g_cfg.autostart = true;
    strcpy(g_cfg.tuyaEndpoint, "https://openapi.tuyaus.com");

    char path[600];
    snprintf(path, sizeof(path), "%s/config.json", g_data_dir);
    FILE *f = fopen(path, "rb");
    if (f) {
        char buf[4096];
        size_t n = fread(buf, 1, sizeof(buf) - 1, f);
        buf[n] = '\0';
        fclose(f);
        json_get_string(buf, "mode", g_cfg.mode, sizeof(g_cfg.mode));
        json_get_bool(buf, "autostart", &g_cfg.autostart);
        json_get_string(buf, "samsungTvIp", g_cfg.samsungTvIp, sizeof(g_cfg.samsungTvIp));
        json_get_string(buf, "samsungTvMac", g_cfg.samsungTvMac, sizeof(g_cfg.samsungTvMac));
        json_get_string(buf, "samsungTvToken", g_cfg.samsungTvToken, sizeof(g_cfg.samsungTvToken));
        json_get_bool(buf, "samsungTvPaired", &g_cfg.samsungTvPaired);
        json_get_string(buf, "haUrl", g_cfg.haUrl, sizeof(g_cfg.haUrl));
        json_get_string(buf, "haToken", g_cfg.haToken, sizeof(g_cfg.haToken));
        json_get_string(buf, "tuyaClientId", g_cfg.tuyaClientId, sizeof(g_cfg.tuyaClientId));
        json_get_string(buf, "tuyaSecret", g_cfg.tuyaSecret, sizeof(g_cfg.tuyaSecret));
        json_get_string(buf, "tuyaEndpoint", g_cfg.tuyaEndpoint, sizeof(g_cfg.tuyaEndpoint));
    }
#ifdef _WIN32
    if (!f) {
        win_set_autostart_registry(true);
        save_config();
    } else {
        g_cfg.autostart = win_get_autostart_registry();
    }
#endif
}

static void init_demo_devices(void) {
    g_device_count = 12;
    memset(g_devices, 0, sizeof(g_devices));

    Device defs[12] = {
        { .id="tv-sala", .name="Samsung Crystal 55\" UHD", .type="tv", .brand="Samsung Tizen", .room="Sala", .ip="192.168.1.51", .mac="8C:79:F5:44:12:A8", .haEntity="media_player.samsung_crystal_55", .online=true, .power=true, .volume=18, .input="Netflix", .x=42, .y=10 },
        { .id="luz-sala", .name="Luz Principal da Sala", .type="light", .brand="Tuya", .room="Sala", .ip="192.168.1.42", .mac="A4:CF:12:8B:3F:01", .haEntity="light.luz_sala", .online=true, .power=true, .brightness=80, .colorTemp=3200, .color="#FFB020", .x=18, .y=19 },
        { .id="luz-cozinha", .name="Luminária da Cozinha", .type="light", .brand="Tuya", .room="Cozinha", .ip="192.168.1.43", .mac="A4:CF:12:8B:3F:02", .haEntity="light.luz_cozinha", .online=true, .power=false, .brightness=100, .colorTemp=4500, .color="#3DD8FF", .x=66, .y=19 },
        { .id="luz-quarto", .name="Luz da Suíte", .type="light", .brand="Tuya", .room="Quarto", .ip="192.168.1.44", .mac="A4:CF:12:8B:3F:03", .haEntity="light.luz_quarto", .online=true, .power=true, .brightness=45, .colorTemp=2700, .color="#FFB020", .x=20, .y=40 },
        { .id="lava-seca-lg", .name="Lava e Seca LG ThinQ", .type="washer", .brand="LG ThinQ", .room="Lavanderia", .ip="192.168.1.50", .mac="9C:5C:8E:11:AA:20", .haEntity="sensor.lava_e_seca_lg", .online=true, .power=true, .status="lavando", .progress=68, .cycle="Algodão + Vapor", .temp=40, .remainMin=32, .x=74, .y=44 },
        { .id="ar-sala", .name="Ar-Condicionado Inverter", .type="ac", .brand="LG ThinQ", .room="Sala", .ip="192.168.1.52", .mac="9C:5C:8E:11:AA:22", .haEntity="climate.ar_sala", .online=true, .power=true, .temp=22, .mode="Frio", .fan="Auto", .x=28, .y=11 },
        { .id="geladeira-lg", .name="Geladeira Smart ThinQ", .type="fridge", .brand="LG ThinQ", .room="Cozinha", .ip="192.168.1.53", .mac="9C:5C:8E:11:AA:23", .haEntity="sensor.geladeira_lg", .online=true, .power=true, .fridgeTemp=3, .freezerTemp=-18, .x=85, .y=17 },
        { .id="fechadura", .name="Trava Blindada do Hall", .type="lock", .brand="Tuya", .room="Entrada", .ip="192.168.1.60", .mac="A4:CF:12:8B:3F:10", .haEntity="lock.fechadura_entrada", .online=true, .power=true, .locked=true, .battery=87, .x=22, .y=52 },
        { .id="camera-entrada", .name="Droide Sentinela (Câmera)", .type="camera", .brand="Tuya", .room="Entrada", .ip="192.168.1.61", .mac="A4:CF:12:8B:3F:11", .haEntity="camera.entrada", .online=true, .power=true, .recording=true, .x=39, .y=52 },
        { .id="tomada-rack", .name="Reator Tomada — Rack TV", .type="plug", .brand="Tuya", .room="Sala", .ip="192.168.1.62", .mac="A4:CF:12:8B:3F:12", .haEntity="switch.tomada_rack", .online=true, .power=true, .watts=148, .x=42, .y=23 },
        { .id="aspirador", .name="Unidade Astromech (Robô)", .type="vacuum", .brand="Tuya", .room="Sala", .ip="192.168.1.70", .mac="A4:CF:12:8B:3F:20", .haEntity="vacuum.aspirador_robo", .online=true, .power=false, .status="parado", .battery=94, .x=12, .y=26 },
        { .id="sensor-temp", .name="Sonda Atmosférica Suíte", .type="sensor", .brand="Tuya", .room="Quarto", .ip="192.168.1.71", .mac="A4:CF:12:8B:3F:21", .haEntity="sensor.temperatura_quarto", .online=true, .power=true, .temp=23.8, .humidity=56, .x=38, .y=40 }
    };
    memcpy(g_devices, defs, sizeof(defs));
    if (g_cfg.samsungTvIp[0]) snprintf(g_devices[0].ip, sizeof(g_devices[0].ip), "%s", g_cfg.samsungTvIp);
    if (g_cfg.samsungTvMac[0]) snprintf(g_devices[0].mac, sizeof(g_devices[0].mac), "%s", g_cfg.samsungTvMac);

    Scene sc[5] = {
        { "cheguei", "Pouso na Base", "◈", "PROTO-01", "Luzes da sala 90%, Samsung Crystal 55\" ligada, clima em 22°C", false },
        { "cinema", "Sessão Holocron", "◎", "PROTO-02", "Luz âmbar em 15%, cozinha apagada, Samsung 55\" em modo Cinema", false },
        { "boa-noite", "Escudos Noturnos", "⬡", "PROTO-03", "Desliga luzes e TV, trava porta do hall e ativa sentinela RTSP", false },
        { "economia", "Reserva de Reator", "⚡", "PROTO-04", "Corta cargas secundárias mantendo geladeira e perímetro", false },
        { "manha", "Alvorada Binária", "☀", "PROTO-05", "Acende suíte e sala suavemente em 2700K", false }
    };
    memcpy(g_scenes, sc, sizeof(sc));
    add_log("HOLONET Desktop iniciado e pronto na rede Wi-Fi.");
}

/* =========================================================================
 * Wake-on-LAN UDP Magic Packet
 * ========================================================================= */
static bool send_wake_on_lan(const char *mac_str) {
    uint8_t mac[6];
    int vals[6];
    if (sscanf(mac_str, "%x:%x:%x:%x:%x:%x", &vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5]) != 6 &&
        sscanf(mac_str, "%x-%x-%x-%x-%x-%x", &vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5]) != 6) {
        return false;
    }
    for (int i = 0; i < 6; i++) mac[i] = (uint8_t)vals[i];
    uint8_t pkt[102];
    memset(pkt, 0xFF, 6);
    for (int i = 0; i < 16; i++) memcpy(pkt + 6 + i * 6, mac, 6);

#ifdef _WIN32
    SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return false;
    BOOL bcast = TRUE;
    setsockopt(s, SOL_SOCKET, SO_BROADCAST, (const char*)&bcast, sizeof(bcast));
#else
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    if (s < 0) return false;
    int bcast = 1;
    setsockopt(s, SOL_SOCKET, SO_BROADCAST, &bcast, sizeof(bcast));
#endif
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(9);
    addr.sin_addr.s_addr = INADDR_BROADCAST;
    int sent = sendto(s, (const char*)pkt, sizeof(pkt), 0, (struct sockaddr*)&addr, sizeof(addr));
#ifdef _WIN32
    closesocket(s);
#else
    close(s);
#endif
    return sent == sizeof(pkt);
}

/* =========================================================================
 * WinHTTP Drivers (Samsung Crystal 55" WSS 8002 + Home Assistant + Tuya)
 * ========================================================================= */
#ifdef _WIN32
static bool winhttp_request(const char *url_utf8, const char *method_utf8, const char *extra_headers_utf8,
                            const char *body, char *resp_out, size_t resp_sz, int *http_status) {
    wchar_t wurl[512];
    MultiByteToWideChar(CP_UTF8, 0, url_utf8, -1, wurl, 512);

    URL_COMPONENTS uc;
    memset(&uc, 0, sizeof(uc));
    uc.dwStructSize = sizeof(uc);
    wchar_t host[256] = {0}, path[512] = {0};
    uc.lpszHostName = host; uc.dwHostNameLength = 255;
    uc.lpszUrlPath = path; uc.dwUrlPathLength = 511;
    if (!WinHttpCrackUrl(wurl, 0, 0, &uc)) return false;

    HINTERNET hSession = WinHttpOpen(L"HOLONET/2.1", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return false;
    WinHttpSetTimeouts(hSession, 3500, 3500, 4000, 5000);

    HINTERNET hConnect = WinHttpConnect(hSession, host, uc.nPort, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return false; }

    wchar_t wmethod[16];
    MultiByteToWideChar(CP_UTF8, 0, method_utf8, -1, wmethod, 16);
    DWORD flags = (uc.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hReq = WinHttpOpenRequest(hConnect, wmethod, path[0] ? path : L"/", NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hReq) { WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); return false; }

    if (flags & WINHTTP_FLAG_SECURE) {
        DWORD sec = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                    SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
        WinHttpSetOption(hReq, WINHTTP_OPTION_SECURITY_FLAGS, &sec, sizeof(sec));
    }

    if (extra_headers_utf8 && extra_headers_utf8[0]) {
        wchar_t whdr[1024];
        MultiByteToWideChar(CP_UTF8, 0, extra_headers_utf8, -1, whdr, 1024);
        WinHttpAddRequestHeaders(hReq, whdr, (DWORD)-1, WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
    }

    DWORD blen = body ? (DWORD)strlen(body) : 0;
    BOOL ok = WinHttpSendRequest(hReq, WINHTTP_NO_ADDITIONAL_HEADERS, 0, (LPVOID)body, blen, blen, 0);
    if (ok) ok = WinHttpReceiveResponse(hReq, NULL);

    if (ok && http_status) {
        DWORD st = 0, st_sz = sizeof(st);
        WinHttpQueryHeaders(hReq, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &st, &st_sz, WINHTTP_NO_HEADER_INDEX);
        *http_status = (int)st;
    }

    if (ok && resp_out && resp_sz > 0) {
        size_t total = 0;
        DWORD avail = 0;
        while (WinHttpQueryDataAvailable(hReq, &avail) && avail > 0 && total + 1 < resp_sz) {
            DWORD to_read = avail;
            if (total + to_read >= resp_sz) to_read = (DWORD)(resp_sz - 1 - total);
            DWORD rd = 0;
            if (!WinHttpReadData(hReq, resp_out + total, to_read, &rd) || rd == 0) break;
            total += rd;
        }
        resp_out[total] = '\0';
    }

    WinHttpCloseHandle(hReq);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return ok != FALSE;
}

static bool samsung_ws_send_keys(const char *tv_ip, char *inout_token, size_t tok_sz, const char *remote_key, int repeat_count, char *err_out, size_t err_sz) {
    wchar_t whost[128];
    MultiByteToWideChar(CP_UTF8, 0, tv_ip, -1, whost, 128);

    wchar_t wpath[512];
    /* "HOLONET Command" em Base64 = SE9MT05FVCBDb21tYW5k */
    if (inout_token && inout_token[0]) {
        wchar_t wtok[128];
        MultiByteToWideChar(CP_UTF8, 0, inout_token, -1, wtok, 128);
        wsprintfW(wpath, L"/api/v2/channels/samsung.remote.control?name=SE9MT05FVCBDb21tYW5k&token=%s", wtok);
    } else {
        wsprintfW(wpath, L"/api/v2/channels/samsung.remote.control?name=SE9MT05FVCBDb21tYW5k");
    }

    HINTERNET hSession = WinHttpOpen(L"HOLONET/2.1", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) { snprintf(err_out, err_sz, "Falha ao abrir WinHTTP"); return false; }
    WinHttpSetTimeouts(hSession, 4000, 4000, 5000, 18000);

    HINTERNET hConnect = WinHttpConnect(hSession, whost, 8002, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); snprintf(err_out, err_sz, "Host inválido"); return false; }

    HINTERNET hReq = WinHttpOpenRequest(hConnect, L"GET", wpath, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
    if (!hReq) { WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); return false; }

    DWORD sec = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    WinHttpSetOption(hReq, WINHTTP_OPTION_SECURITY_FLAGS, &sec, sizeof(sec));
    WinHttpSetOption(hReq, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0);

    if (!WinHttpSendRequest(hReq, WINHTTP_NO_ADDITIONAL_HEADERS, 0, NULL, 0, 0, 0) || !WinHttpReceiveResponse(hReq, NULL)) {
        WinHttpCloseHandle(hReq); WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession);
        snprintf(err_out, err_sz, "Não foi possível conectar na porta 8002 da TV Samsung (%s). Confirme se ela está ligada no mesmo Wi-Fi.", tv_ip);
        return false;
    }

    HINTERNET hWs = WinHttpWebSocketCompleteUpgrade(hReq, 0);
    WinHttpCloseHandle(hReq);
    if (!hWs) {
        WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession);
        snprintf(err_out, err_sz, "Upgrade WebSocket recusado pela TV Samsung.");
        return false;
    }

    char rx[4096] = {0};
    DWORD rd = 0;
    WINHTTP_WEB_SOCKET_BUFFER_TYPE btype;
    if (WinHttpWebSocketReceive(hWs, rx, sizeof(rx) - 1, &rd, &btype) != NO_ERROR) {
        WinHttpCloseHandle(hWs); WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession);
        snprintf(err_out, err_sz, "Tempo esgotado aguardando 'Permitir' na tela da Samsung Crystal 55\".");
        return false;
    }
    rx[rd] = '\0';

    if (strstr(rx, "ms.channel.unauthorized")) {
        WinHttpCloseHandle(hWs); WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession);
        snprintf(err_out, err_sz, "Conexão negada na TV! Vá em Configurações -> Geral -> Gerenciador de Dispositivos Externos -> Lista de Dispositivos na TV Samsung e permita.");
        return false;
    }

    char new_tok[64] = {0};
    if (json_get_string(rx, "token", new_tok, sizeof(new_tok)) && new_tok[0] && inout_token) {
        snprintf(inout_token, tok_sz, "%s", new_tok);
    }

    if (remote_key && remote_key[0] && repeat_count > 0) {
        char cmd[256];
        snprintf(cmd, sizeof(cmd),
            "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"%s\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}",
            remote_key);
        for (int i = 0; i < repeat_count; i++) {
            WinHttpWebSocketSend(hWs, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE, (PVOID)cmd, (DWORD)strlen(cmd));
            if (i + 1 < repeat_count) Sleep(120);
        }
        Sleep(80);
    }

    WinHttpWebSocketClose(hWs, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
    WinHttpCloseHandle(hWs);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return true;
}
#endif

/* =========================================================================
 * Serializadores JSON para todas as rotas do Frontend
 * ========================================================================= */
static size_t serialize_device(const Device *d, char *buf, size_t max_sz) {
    char eName[192], eBrand[96], eRoom[96], eIp[128], eMac[64], eHa[160], eTuya[160], eInput[64], eStatus[64], eCycle[96], eMode[48], eFan[48];
    json_escape(d->name, eName, sizeof(eName));
    json_escape(d->brand, eBrand, sizeof(eBrand));
    json_escape(d->room, eRoom, sizeof(eRoom));
    json_escape(d->ip, eIp, sizeof(eIp));
    json_escape(d->mac, eMac, sizeof(eMac));
    json_escape(d->haEntity, eHa, sizeof(eHa));
    json_escape(d->tuyaId, eTuya, sizeof(eTuya));
    json_escape(d->input, eInput, sizeof(eInput));
    json_escape(d->status, eStatus, sizeof(eStatus));
    json_escape(d->cycle, eCycle, sizeof(eCycle));
    json_escape(d->mode, eMode, sizeof(eMode));
    json_escape(d->fan, eFan, sizeof(eFan));

    int n = snprintf(buf, max_sz,
        "{\"id\":\"%s\",\"name\":\"%s\",\"type\":\"%s\",\"brand\":\"%s\",\"room\":\"%s\","
        "\"ip\":\"%s\",\"mac\":\"%s\",\"haEntity\":\"%s\",\"tuyaId\":\"%s\","
        "\"online\":%s,\"power\":%s,\"brightness\":%d,\"colorTemp\":%d,\"color\":\"%s\","
        "\"volume\":%d,\"muted\":%s,\"input\":\"%s\",\"status\":\"%s\",\"progress\":%d,"
        "\"cycle\":\"%s\",\"temp\":%.1f,\"remainMin\":%d,\"mode\":\"%s\",\"fan\":\"%s\","
        "\"fridgeTemp\":%d,\"freezerTemp\":%d,\"locked\":%s,\"battery\":%d,"
        "\"recording\":%s,\"watts\":%d,\"humidity\":%d,\"x\":%d,\"y\":%d}",
        d->id, eName, d->type, eBrand, eRoom,
        eIp, eMac, eHa, eTuya,
        d->online ? "true" : "false", d->power ? "true" : "false",
        d->brightness, d->colorTemp, d->color[0] ? d->color : "#FFB020",
        d->volume, d->muted ? "true" : "false", eInput, eStatus, d->progress,
        eCycle, d->temp, d->remainMin, eMode, eFan,
        d->fridgeTemp, d->freezerTemp, d->locked ? "true" : "false", d->battery,
        d->recording ? "true" : "false", d->watts, d->humidity, d->x, d->y
    );
    return (n > 0 && (size_t)n < max_sz) ? (size_t)n : 0;
}

static size_t serialize_all_devices(char *buf, size_t max_sz) {
    size_t pos = (size_t)snprintf(buf, max_sz, "{\"devices\":[");
    for (int i = 0; i < g_device_count; i++) {
        if (i > 0 && pos + 2 < max_sz) buf[pos++] = ',';
        pos += serialize_device(&g_devices[i], buf + pos, max_sz - pos);
    }
    pos += (size_t)snprintf(buf + pos, max_sz - pos, "],\"count\":%d,\"mode\":\"%s\"}", g_device_count, g_cfg.mode);
    return pos;
}

/* =========================================================================
 * Resposta HTTP
 * ========================================================================= */
#ifdef _WIN32
typedef SOCKET sock_t;
#define CLOSESOCK closesocket
#else
typedef int sock_t;
#define CLOSESOCK close
#endif

static void send_all(sock_t s, const void *data, size_t len) {
    const char *p = (const char*)data;
    size_t sent = 0;
    while (sent < len) {
        int n = send(s, p + sent, (int)(len - sent), 0);
        if (n <= 0) break;
        sent += (size_t)n;
    }
}

static void send_http(sock_t s, int status, const char *mime, const void *body, size_t body_len) {
    const char *st_txt = status == 200 ? "OK" : status == 201 ? "Created" : status == 400 ? "Bad Request" : status == 404 ? "Not Found" : "Error";
    char hdr[512];
    int hlen = snprintf(hdr, sizeof(hdr),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Connection: close\r\n\r\n",
        status, st_txt, mime, body_len);
    send_all(s, hdr, (size_t)hlen);
    if (body && body_len > 0) send_all(s, body, body_len);
}

static void send_json(sock_t s, int status, const char *json) {
    send_http(s, status, "application/json; charset=utf-8", json, strlen(json));
}

/* =========================================================================
 * Scanner Wi-Fi Local não-bloqueante
 * ========================================================================= */
static void get_local_ipv4(char ip_out[64], char name_out[64]) {
    strcpy(ip_out, "127.0.0.1");
    strcpy(name_out, "Wi-Fi");
    sock_t s = socket(AF_INET, SOCK_DGRAM, 0);
    if ((int)s >= 0) {
        struct sockaddr_in dst;
        memset(&dst, 0, sizeof(dst));
        dst.sin_family = AF_INET;
        dst.sin_port = htons(53);
        inet_pton(AF_INET, "8.8.8.8", &dst.sin_addr);
        if (connect(s, (struct sockaddr*)&dst, sizeof(dst)) == 0) {
            struct sockaddr_in loc;
            socklen_t lsz = sizeof(loc);
            if (getsockname(s, (struct sockaddr*)&loc, &lsz) == 0) {
                inet_ntop(AF_INET, &loc.sin_addr, ip_out, 64);
            }
        }
        CLOSESOCK(s);
    }
}

static void handle_network_scan(sock_t client, bool quick) {
    char local_ip[64], ifname[64];
    get_local_ipv4(local_ip, ifname);

    int a=192, b=168, c=1, d_self=1;
    if (sscanf(local_ip, "%d.%d.%d.%d", &a, &b, &c, &d_self) != 4 || a == 127) {
        quick = true;
    }

    char *out = (char*)malloc(65536);
    if (!out) return;
    size_t pos = (size_t)snprintf(out, 65536,
        "{\"local\":{\"name\":\"%s\",\"address\":\"%s\",\"mac\":\"LOCAL-HOST\"},\"subnet\":\"%d.%d.%d.0/24\",\"scanned\":%d,\"found\":[",
        ifname, local_ip, a, b, c, quick ? 0 : 254);

    int found_cnt = 0;
    if (!quick) {
        const int ports[6] = { 8001, 8002, 8123, 6668, 554, 80 };
        for (int base = 1; base <= 254; base += 42) {
            int end = base + 41;
            if (end > 254) end = 254;
            int cnt = end - base + 1;
            sock_t socks[42 * 6];
            for (int i = 0; i < cnt; i++) {
                int host_i = base + i;
                for (int p = 0; p < 6; p++) {
                    int idx = i * 6 + p;
                    if (host_i == d_self) { socks[idx] = (sock_t)-1; continue; }
                    sock_t sk = socket(AF_INET, SOCK_STREAM, 0);
#ifdef _WIN32
                    u_long nb = 1; ioctlsocket(sk, FIONBIO, &nb);
#else
                    fcntl(sk, F_SETFL, O_NONBLOCK);
#endif
                    struct sockaddr_in sa;
                    memset(&sa, 0, sizeof(sa));
                    sa.sin_family = AF_INET;
                    sa.sin_port = htons((uint16_t)ports[p]);
                    char ipbuf[32];
                    snprintf(ipbuf, sizeof(ipbuf), "%d.%d.%d.%d", a, b, c, host_i);
                    inet_pton(AF_INET, ipbuf, &sa.sin_addr);
                    connect(sk, (struct sockaddr*)&sa, sizeof(sa));
                    socks[idx] = sk;
                }
            }

            fd_set wfds;
            FD_ZERO(&wfds);
            sock_t maxfd = 0;
            for (int k = 0; k < cnt * 6; k++) {
                if (socks[k] != (sock_t)-1) {
                    FD_SET(socks[k], &wfds);
                    if (socks[k] > maxfd) maxfd = socks[k];
                }
            }
            struct timeval tv = { 0, 260000 }; /* 260ms por lote -> ~1.5s total */
            select((int)maxfd + 1, NULL, &wfds, NULL, &tv);

            for (int i = 0; i < cnt; i++) {
                int host_i = base + i;
                int open_p[6], open_n = 0;
                bool is_sam = false, is_ha = false, is_tuya = false, is_cam = false;
                for (int p = 0; p < 6; p++) {
                    sock_t sk = socks[i * 6 + p];
                    if (sk == (sock_t)-1) continue;
                    if (FD_ISSET(sk, &wfds)) {
                        int err = 0; socklen_t elen = sizeof(err);
                        if (getsockopt(sk, SOL_SOCKET, SO_ERROR, (char*)&err, &elen) == 0 && err == 0) {
                            open_p[open_n++] = ports[p];
                            if (ports[p] == 8001 || ports[p] == 8002) is_sam = true;
                            if (ports[p] == 8123) is_ha = true;
                            if (ports[p] == 6668) is_tuya = true;
                            if (ports[p] == 554) is_cam = true;
                        }
                    }
                    CLOSESOCK(sk);
                }
                if (open_n > 0 && pos + 512 < 65536) {
                    char ipbuf[32], macbuf[32] = "", hint[128];
                    snprintf(ipbuf, sizeof(ipbuf), "%d.%d.%d.%d", a, b, c, host_i);
                    const char *sug = "plug";
                    if (is_sam) { strcpy(hint, "★ TV Samsung Smart (Crystal / Tizen)"); sug = "tv"; }
                    else if (is_ha) { strcpy(hint, "★ Home Assistant Hub"); sug = "sensor"; }
                    else if (is_tuya) { strcpy(hint, "Dispositivo Tuya / Smart Life Local"); sug = "light"; }
                    else if (is_cam) { strcpy(hint, "Câmera IP Sentinela (RTSP)"); sug = "camera"; }
                    else { strcpy(hint, "Dispositivo Wi-Fi Ativo"); }

#ifdef _WIN32
                    if (is_sam) {
                        char url[128], info_json[2048] = {0};
                        int st = 0;
                        snprintf(url, sizeof(url), "http://%s:8001/api/v2/", ipbuf);
                        if (winhttp_request(url, "GET", NULL, NULL, info_json, sizeof(info_json), &st) && st == 200) {
                            char mname[64] = {0};
                            json_get_string(info_json, "modelName", mname, sizeof(mname));
                            json_get_string(info_json, "wifiMac", macbuf, sizeof(macbuf));
                            if (mname[0]) snprintf(hint, sizeof(hint), "★ Samsung Smart TV (%s)", mname);
                        }
                    }
#endif
                    if (found_cnt++ > 0) out[pos++] = ',';
                    pos += (size_t)snprintf(out + pos, 65536 - pos, "{\"ip\":\"%s\",\"mac\":\"%s\",\"isSamsung\":%s,\"suggestedType\":\"%s\",\"hint\":\"%s\",\"openPorts\":[",
                        ipbuf, macbuf, is_sam ? "true" : "false", sug, hint);
                    for (int k = 0; k < open_n; k++) {
                        pos += (size_t)snprintf(out + pos, 65536 - pos, "%s%d", k ? "," : "", open_p[k]);
                    }
                    pos += (size_t)snprintf(out + pos, 65536 - pos, "]}");
                }
            }
        }
    }
    pos += (size_t)snprintf(out + pos, 65536 - pos, "]}");
    send_json(client, 200, out);
    free(out);
}

/* =========================================================================
 * Roteador HTTP Principal
 * ========================================================================= */
static void handle_client(sock_t client) {
    char *req = (char*)malloc(16384);
    if (!req) { CLOSESOCK(client); return; }
    int total = 0;
    while (total < 16380) {
        int r = recv(client, req + total, 16380 - total, 0);
        if (r <= 0) break;
        total += r;
        req[total] = '\0';
        char *hdr_end = strstr(req, "\r\n\r\n");
        if (hdr_end) {
            int hdr_len = (int)(hdr_end - req) + 4;
            int content_len = 0;
            const char *cl = strstr(req, "Content-Length:");
            if (!cl) cl = strstr(req, "content-length:");
            if (cl) content_len = atoi(cl + 15);
            if (total >= hdr_len + content_len) break;
        }
    }
    if (total <= 0) { free(req); CLOSESOCK(client); return; }

    char method[16] = {0}, full_path[256] = {0};
    sscanf(req, "%15s %255s", method, full_path);

    if (strcmp(method, "OPTIONS") == 0) {
        send_http(client, 200, "text/plain", "", 0);
        free(req); CLOSESOCK(client); return;
    }

    const char *body = strstr(req, "\r\n\r\n");
    body = body ? body + 4 : "";

    char path[256] = {0}, query[128] = {0};
    const char *q = strchr(full_path, '?');
    if (q) {
        size_t plen = (size_t)(q - full_path);
        if (plen >= sizeof(path)) plen = sizeof(path) - 1;
        memcpy(path, full_path, plen);
        snprintf(query, sizeof(query), "%s", q + 1);
    } else {
        snprintf(path, sizeof(path), "%s", full_path);
    }

    char *resp = (char*)malloc(65536);
    if (!resp) { free(req); CLOSESOCK(client); return; }

    /* 1. Health */
    if (strcmp(path, "/api/health") == 0 && strcmp(method, "GET") == 0) {
        char ts[32]; iso_now(ts);
        lock_state();
        snprintf(resp, 65536,
            "{\"ok\":true,\"app\":\"HOLONET Desktop\",\"version\":\"2.1.0\",\"runtime\":\"win32-native\","
            "\"autostart\":%s,\"mode\":\"%s\",\"samsungTvPaired\":%s,\"haConfigured\":%s,\"tuyaConfigured\":%s,\"time\":\"%s\"}",
            g_cfg.autostart ? "true" : "false",
            g_cfg.mode,
            (g_cfg.samsungTvPaired && g_cfg.samsungTvIp[0]) ? "true" : "false",
            (g_cfg.haUrl[0] && g_cfg.haToken[0]) ? "true" : "false",
            (g_cfg.tuyaClientId[0] && g_cfg.tuyaSecret[0]) ? "true" : "false",
            ts);
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 2. Autostart */
    else if (strcmp(path, "/api/autostart") == 0) {
        lock_state();
        if (strcmp(method, "POST") == 0) {
            bool en = !g_cfg.autostart;
            json_get_bool(body, "enabled", &en);
            g_cfg.autostart = en;
#ifdef _WIN32
            win_set_autostart_registry(en);
#endif
            save_config();
            add_log(en ? "Auto-iniciar com o Windows ATIVADO." : "Auto-iniciar com o Windows DESATIVADO.");
        }
        snprintf(resp, 65536, "{\"ok\":true,\"enabled\":%s}", g_cfg.autostart ? "true" : "false");
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 3. Lista dispositivos */
    else if (strcmp(path, "/api/devices") == 0 && strcmp(method, "GET") == 0) {
        lock_state();
        serialize_all_devices(resp, 65536);
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 4. Adicionar novo dispositivo */
    else if (strcmp(path, "/api/devices") == 0 && strcmp(method, "POST") == 0) {
        lock_state();
        if (g_device_count >= MAX_DEVICES) {
            unlock_state();
            send_json(client, 400, "{\"error\":\"Limite de unidades atingido\"}");
        } else {
            Device *nd = &g_devices[g_device_count];
            memset(nd, 0, sizeof(Device));
            snprintf(nd->id, sizeof(nd->id), "unit-%d", 100 + g_device_count);
            json_get_string(body, "name", nd->name, sizeof(nd->name));
            json_get_string(body, "type", nd->type, sizeof(nd->type));
            json_get_string(body, "room", nd->room, sizeof(nd->room));
            json_get_string(body, "brand", nd->brand, sizeof(nd->brand));
            json_get_string(body, "ip", nd->ip, sizeof(nd->ip));
            json_get_string(body, "mac", nd->mac, sizeof(nd->mac));
            json_get_string(body, "haEntity", nd->haEntity, sizeof(nd->haEntity));
            json_get_string(body, "tuyaId", nd->tuyaId, sizeof(nd->tuyaId));
            if (!nd->room[0]) strcpy(nd->room, "Sala");
            if (!nd->brand[0]) strcpy(nd->brand, "Wi-Fi");
            nd->online = true; nd->power = true; nd->brightness = 100; nd->colorTemp = 3500;
            strcpy(nd->color, "#FFB020"); nd->volume = 20; strcpy(nd->input, "Netflix");
            nd->temp = 22; strcpy(nd->mode, "Auto"); strcpy(nd->fan, "Auto"); nd->watts = 45;
            nd->battery = 100; nd->locked = true; nd->x = 50; nd->y = 30;
            g_device_count++;
            size_t p = (size_t)snprintf(resp, 65536, "{\"ok\":true,\"device\":");
            p += serialize_device(nd, resp + p, 65536 - p);
            snprintf(resp + p, 65536 - p, "}");
            add_log("Nova unidade registrada no Holomapa.");
            unlock_state();
            send_json(client, 201, resp);
        }
    }
    /* 5. Comando ou Patch em /api/devices/:id */
    else if (strncmp(path, "/api/devices/", 13) == 0) {
        char sub[256];
        snprintf(sub, sizeof(sub), "%s", path + 13);
        char *slash = strchr(sub, '/');
        bool is_cmd = slash && strcmp(slash, "/command") == 0;
        if (slash) *slash = '\0';

        lock_state();
        Device *d = NULL;
        for (int i = 0; i < g_device_count; i++) {
            if (strcmp(g_devices[i].id, sub) == 0) { d = &g_devices[i]; break; }
        }
        if (!d) {
            unlock_state();
            send_json(client, 404, "{\"error\":\"Dispositivo não encontrado\"}");
        } else if (strcmp(method, "PATCH") == 0) {
            json_get_string(body, "name", d->name, sizeof(d->name));
            json_get_string(body, "room", d->room, sizeof(d->room));
            json_get_string(body, "brand", d->brand, sizeof(d->brand));
            json_get_string(body, "ip", d->ip, sizeof(d->ip));
            json_get_string(body, "mac", d->mac, sizeof(d->mac));
            json_get_string(body, "haEntity", d->haEntity, sizeof(d->haEntity));
            json_get_string(body, "tuyaId", d->tuyaId, sizeof(d->tuyaId));
            size_t p = (size_t)snprintf(resp, 65536, "{\"ok\":true,\"device\":");
            p += serialize_device(d, resp + p, 65536 - p);
            snprintf(resp + p, 65536 - p, "}");
            unlock_state();
            send_json(client, 200, resp);
        } else if (is_cmd && strcmp(method, "POST") == 0) {
            char action[32] = {0}, val_str[64] = {0};
            double val_num = 0; bool has_num = json_get_number(body, "value", &val_num);
            bool val_bool = false; bool has_bool = json_get_bool(body, "value", &val_bool);
            json_get_string(body, "action", action, sizeof(action));
            json_get_string(body, "value", val_str, sizeof(val_str));
            int prev_vol = d->volume;
            (void)prev_vol;

            if (strcmp(action, "toggle") == 0 || strcmp(action, "power") == 0) {
                d->power = has_bool ? val_bool : !d->power;
                if (strcmp(d->type, "lock") == 0) d->locked = d->power;
                if (strcmp(d->type, "washer") == 0) strcpy(d->status, d->power ? "lavando" : "pausado");
                if (strcmp(d->type, "vacuum") == 0) strcpy(d->status, d->power ? "limpando" : "parado");
            } else if (strcmp(action, "brightness") == 0 && has_num) {
                d->brightness = clamp_int((int)val_num, 0, 100);
                if (d->brightness > 0) d->power = true;
            } else if (strcmp(action, "colorTemp") == 0 && has_num) {
                d->colorTemp = clamp_int((int)val_num, 2200, 6500);
            } else if (strcmp(action, "color") == 0) {
                snprintf(d->color, sizeof(d->color), "%s", val_str);
            } else if (strcmp(action, "volume") == 0 && has_num) {
                d->volume = clamp_int((int)val_num, 0, 100);
            } else if (strcmp(action, "temp") == 0 && has_num) {
                d->temp = val_num;
            } else if (strcmp(action, "fridgeTemp") == 0 && has_num) {
                d->fridgeTemp = clamp_int((int)val_num, 1, 7);
            } else if (strcmp(action, "freezerTemp") == 0 && has_num) {
                d->freezerTemp = clamp_int((int)val_num, -22, -14);
            } else if (strcmp(action, "mode") == 0) {
                snprintf(d->mode, sizeof(d->mode), "%s", val_str);
            } else if (strcmp(action, "fan") == 0) {
                snprintf(d->fan, sizeof(d->fan), "%s", val_str);
            } else if (strcmp(action, "input") == 0) {
                snprintf(d->input, sizeof(d->input), "%s", val_str);
                d->power = true;
            } else if (strcmp(action, "cycle") == 0) {
                snprintf(d->cycle, sizeof(d->cycle), "%s", val_str);
            } else if (strcmp(action, "lock") == 0) {
                d->locked = has_bool ? val_bool : !d->locked;
                d->power = d->locked;
            } else if (strcmp(action, "start") == 0) {
                d->power = true;
                if (strcmp(d->type, "washer") == 0) strcpy(d->status, "lavando");
                if (strcmp(d->type, "vacuum") == 0) strcpy(d->status, "limpando");
            } else if (strcmp(action, "pause") == 0) {
                if (strcmp(d->type, "washer") == 0) strcpy(d->status, "pausado");
                if (strcmp(d->type, "vacuum") == 0) { strcpy(d->status, "parado"); d->power = false; }
            } else if (strcmp(action, "remote") == 0) {
                if (strcmp(val_str, "mute") == 0) d->muted = !d->muted;
                if (strcmp(val_str, "vol+") == 0) d->volume = clamp_int(d->volume + 2, 0, 100);
                if (strcmp(val_str, "vol-") == 0) d->volume = clamp_int(d->volume - 2, 0, 100);
            }

            Device copy = *d;
            AppConfig cfg_copy = g_cfg;
            (void)cfg_copy;
            unlock_state();

            const char *bridge = "demo";
#ifdef _WIN32
            /* Ponte Real Samsung Crystal 55" Tizen */
            if (strcmp(copy.type, "tv") == 0 && cfg_copy.samsungTvPaired && cfg_copy.samsungTvIp[0]) {
                char err[256] = {0};
                char tok[64]; snprintf(tok, sizeof(tok), "%s", cfg_copy.samsungTvToken);
                if ((strcmp(action, "toggle") == 0 || strcmp(action, "power") == 0) && copy.power && cfg_copy.samsungTvMac[0]) {
                    send_wake_on_lan(cfg_copy.samsungTvMac);
                    bridge = "samsung-wol";
                } else if (strcmp(action, "input") == 0) {
                    const char *app_id = NULL;
                    if (strcmp(val_str, "Netflix") == 0) app_id = "3201907018807";
                    else if (strcmp(val_str, "YouTube") == 0) app_id = "111299001912";
                    else if (strcmp(val_str, "Prime Video") == 0) app_id = "3201910019365";
                    else if (strcmp(val_str, "Disney+") == 0) app_id = "3201901017640";
                    else if (strcmp(val_str, "Spotify") == 0) app_id = "3201606009684";
                    if (app_id) {
                        char url[192], rbuf[256]; int st = 0;
                        snprintf(url, sizeof(url), "http://%s:8001/api/v2/applications/%s", cfg_copy.samsungTvIp, app_id);
                        if (winhttp_request(url, "POST", "Content-Type: application/x-www-form-urlencoded\r\n", "", rbuf, sizeof(rbuf), &st))
                            bridge = "samsung-tizen-wifi";
                    } else {
                        const char *k = strncmp(val_str, "HDMI", 4) == 0 ? "KEY_HDMI" : "KEY_SOURCE";
                        if (samsung_ws_send_keys(cfg_copy.samsungTvIp, tok, sizeof(tok), k, 1, err, sizeof(err)))
                            bridge = "samsung-tizen-wifi";
                    }
                } else {
                    const char *k = NULL; int reps = 1;
                    if (strcmp(action, "toggle") == 0 || strcmp(action, "power") == 0) k = "KEY_POWER";
                    else if (strcmp(action, "volume") == 0) {
                        int diff = clamp_int(copy.volume - prev_vol, -10, 10);
                        if (diff != 0) { k = diff > 0 ? "KEY_VOLUP" : "KEY_VOLDOWN"; reps = abs(diff); }
                    } else if (strcmp(action, "remote") == 0) {
                        if (strcmp(val_str, "vol+") == 0) k = "KEY_VOLUP";
                        else if (strcmp(val_str, "vol-") == 0) k = "KEY_VOLDOWN";
                        else if (strcmp(val_str, "mute") == 0) k = "KEY_MUTE";
                        else if (strcmp(val_str, "up") == 0) k = "KEY_UP";
                        else if (strcmp(val_str, "down") == 0) k = "KEY_DOWN";
                        else if (strcmp(val_str, "left") == 0) k = "KEY_LEFT";
                        else if (strcmp(val_str, "right") == 0) k = "KEY_RIGHT";
                        else if (strcmp(val_str, "ok") == 0) k = "KEY_ENTER";
                        else if (strcmp(val_str, "back") == 0) k = "KEY_RETURN";
                        else if (strcmp(val_str, "home") == 0) k = "KEY_HOME";
                        else if (strcmp(val_str, "source") == 0) k = "KEY_SOURCE";
                        else if (strcmp(val_str, "ch+") == 0) k = "KEY_CHUP";
                        else if (strcmp(val_str, "ch-") == 0) k = "KEY_CHDOWN";
                        else if (strcmp(val_str, "play") == 0) k = "KEY_PLAY";
                        else if (strcmp(val_str, "pause") == 0) k = "KEY_PAUSE";
                    }
                    if (k && samsung_ws_send_keys(cfg_copy.samsungTvIp, tok, sizeof(tok), k, reps, err, sizeof(err))) {
                        bridge = "samsung-tizen-wifi";
                        if (tok[0] && strcmp(tok, cfg_copy.samsungTvToken) != 0) {
                            lock_state();
                            snprintf(g_cfg.samsungTvToken, sizeof(g_cfg.samsungTvToken), "%s", tok);
                            save_config();
                            unlock_state();
                        }
                    }
                }
            }
            /* Ponte Real Home Assistant */
            if (strcmp(bridge, "demo") == 0 && strcmp(cfg_copy.mode, "homeassistant") == 0 && cfg_copy.haUrl[0] && cfg_copy.haToken[0] && copy.haEntity[0]) {
                char domain[32] = {0};
                const char *dot = strchr(copy.haEntity, '.');
                if (dot) {
                    size_t dl = (size_t)(dot - copy.haEntity);
                    if (dl < sizeof(domain)) memcpy(domain, copy.haEntity, dl);
                    const char *svc = copy.power ? "turn_on" : "turn_off";
                    char url[256], hdrs[384], pbody[256], rbuf[512]; int st = 0;
                    snprintf(url, sizeof(url), "%s/api/services/%s/%s", cfg_copy.haUrl, domain, svc);
                    snprintf(hdrs, sizeof(hdrs), "Authorization: Bearer %s\r\nContent-Type: application/json\r\n", cfg_copy.haToken);
                    snprintf(pbody, sizeof(pbody), "{\"entity_id\":\"%s\"}", copy.haEntity);
                    if (winhttp_request(url, "POST", hdrs, pbody, rbuf, sizeof(rbuf), &st) && st >= 200 && st < 300)
                        bridge = "homeassistant";
                }
            }
#endif
            lock_state();
            char lmsg[192];
            snprintf(lmsg, sizeof(lmsg), "%s -> %s [%s]", copy.name, action, bridge);
            add_log(lmsg);
            size_t p = (size_t)snprintf(resp, 65536, "{\"ok\":true,\"bridge\":\"%s\",\"mode\":\"%s\",\"device\":", bridge, g_cfg.mode);
            p += serialize_device(&copy, resp + p, 65536 - p);
            snprintf(resp + p, 65536 - p, "}");
            unlock_state();
            send_json(client, 200, resp);
        } else {
            unlock_state();
            send_json(client, 400, "{\"error\":\"Requisição inválida\"}");
        }
    }
    /* 6. Cenas */
    else if (strcmp(path, "/api/scenes") == 0 && strcmp(method, "GET") == 0) {
        lock_state();
        size_t p = (size_t)snprintf(resp, 65536, "{\"scenes\":[");
        for (int i = 0; i < 5; i++) {
            char eName[128], eDesc[256];
            json_escape(g_scenes[i].name, eName, sizeof(eName));
            json_escape(g_scenes[i].desc, eDesc, sizeof(eDesc));
            p += (size_t)snprintf(resp + p, 65536 - p,
                "%s{\"id\":\"%s\",\"name\":\"%s\",\"icon\":\"%s\",\"code\":\"%s\",\"desc\":\"%s\",\"active\":%s}",
                i ? "," : "", g_scenes[i].id, eName, g_scenes[i].icon, g_scenes[i].code, eDesc,
                g_scenes[i].active ? "true" : "false");
        }
        snprintf(resp + p, 65536 - p, "]}");
        unlock_state();
        send_json(client, 200, resp);
    }
    else if (strncmp(path, "/api/scenes/", 12) == 0 && strcmp(method, "POST") == 0) {
        char sid[256] = {0};
        snprintf(sid, sizeof(sid), "%s", path + 12);
        char *sl = strchr(sid, '/'); if (sl) *sl = '\0';
        lock_state();
        for (int i = 0; i < 5; i++) g_scenes[i].active = (strcmp(g_scenes[i].id, sid) == 0);
        if (strcmp(sid, "cinema") == 0) {
            g_devices[1].power = true; g_devices[1].brightness = 15;
            g_devices[2].power = false; g_devices[0].power = true;
        } else if (strcmp(sid, "boa-noite") == 0) {
            for (int i = 0; i < g_device_count; i++) {
                if (strcmp(g_devices[i].type, "fridge") != 0 && strcmp(g_devices[i].type, "camera") != 0 && strcmp(g_devices[i].type, "sensor") != 0)
                    g_devices[i].power = false;
            }
            g_devices[7].locked = true; g_devices[7].power = true;
        } else if (strcmp(sid, "cheguei") == 0) {
            g_devices[1].power = true; g_devices[1].brightness = 90;
            g_devices[0].power = true; g_devices[5].power = true;
        }
        add_log("Protocolo de cena executado.");
        size_t p = (size_t)snprintf(resp, 65536, "{\"ok\":true,\"scenes\":[");
        for (int i = 0; i < 5; i++) {
            char eName[128], eDesc[256];
            json_escape(g_scenes[i].name, eName, sizeof(eName));
            json_escape(g_scenes[i].desc, eDesc, sizeof(eDesc));
            p += (size_t)snprintf(resp + p, 65536 - p,
                "%s{\"id\":\"%s\",\"name\":\"%s\",\"icon\":\"%s\",\"code\":\"%s\",\"desc\":\"%s\",\"active\":%s}",
                i ? "," : "", g_scenes[i].id, eName, g_scenes[i].icon, g_scenes[i].code, eDesc,
                g_scenes[i].active ? "true" : "false");
        }
        p += (size_t)snprintf(resp + p, 65536 - p, "],\"devices\":[");
        for (int i = 0; i < g_device_count; i++) {
            if (i > 0) resp[p++] = ',';
            p += serialize_device(&g_devices[i], resp + p, 65536 - p);
        }
        snprintf(resp + p, 65536 - p, "]}");
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 7. Energia */
    else if (strcmp(path, "/api/energy") == 0) {
        lock_state();
        int watts = 0;
        for (int i = 0; i < g_device_count; i++) {
            if (!g_devices[i].power) continue;
            const char *t = g_devices[i].type;
            if (strcmp(t, "washer") == 0) watts += 1450;
            else if (strcmp(t, "ac") == 0) watts += 980;
            else if (strcmp(t, "tv") == 0) watts += 135;
            else if (strcmp(t, "fridge") == 0) watts += 115;
            else if (strcmp(t, "plug") == 0) watts += g_devices[i].watts;
            else if (strcmp(t, "light") == 0) watts += 10;
            else watts += 8;
        }
        int month_brl = (int)((watts / 1000.0) * 7.5 * 30.0 * 0.89);
        size_t p = (size_t)snprintf(resp, 65536, "{\"nowWatts\":%d,\"todayKwh\":8.2,\"estimatedMonthBRL\":%d,\"hours\":[", watts, month_brl);
        for (int h = 0; h < 24; h++) {
            double kwh = 0.25 + fabs(sin(h / 3.2)) * 1.2 + ((h >= 18 && h <= 22) ? 0.8 : 0.0);
            p += (size_t)snprintf(resp + p, 65536 - p, "%s{\"hour\":\"%02d:00\",\"kwh\":%.2f}", h ? "," : "", h, kwh);
        }
        p += (size_t)snprintf(resp + p, 65536 - p, "],\"breakdown\":[");
        int bcnt = 0;
        for (int i = 0; i < g_device_count; i++) {
            if (!g_devices[i].power) continue;
            const char *t = g_devices[i].type;
            int w = strcmp(t, "washer") == 0 ? 1450 : strcmp(t, "ac") == 0 ? 980 : strcmp(t, "tv") == 0 ? 135 : strcmp(t, "fridge") == 0 ? 115 : strcmp(t, "plug") == 0 ? g_devices[i].watts : 10;
            char en[192], er[96];
            json_escape(g_devices[i].name, en, sizeof(en));
            json_escape(g_devices[i].room, er, sizeof(er));
            p += (size_t)snprintf(resp + p, 65536 - p, "%s{\"name\":\"%s\",\"room\":\"%s\",\"watts\":%d}", bcnt++ ? "," : "", en, er, w);
        }
        snprintf(resp + p, 65536 - p, "]}");
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 8. Log */
    else if (strcmp(path, "/api/activity") == 0) {
        lock_state();
        size_t p = (size_t)snprintf(resp, 65536, "{\"log\":[");
        for (int i = 0; i < g_log_count; i++) {
            char et[440]; json_escape(g_logs[i].text, et, sizeof(et));
            p += (size_t)snprintf(resp + p, 65536 - p, "%s{\"time\":\"%s\",\"text\":\"%s\"}", i ? "," : "", g_logs[i].time, et);
        }
        snprintf(resp + p, 65536 - p, "]}");
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 9. Scanner Wi-Fi */
    else if (strcmp(path, "/api/network/scan") == 0) {
        bool quick = strstr(query, "quick=1") != NULL;
        handle_network_scan(client, quick);
    }
    /* 10. Integrações */
    else if (strcmp(path, "/api/integrations/status") == 0) {
        lock_state();
        char eSamIp[128], eSamMac[64], eHaUrl[256], eTuyaId[192], eTuyaEp[256];
        json_escape(g_cfg.samsungTvIp, eSamIp, sizeof(eSamIp));
        json_escape(g_cfg.samsungTvMac, eSamMac, sizeof(eSamMac));
        json_escape(g_cfg.haUrl, eHaUrl, sizeof(eHaUrl));
        json_escape(g_cfg.tuyaClientId, eTuyaId, sizeof(eTuyaId));
        json_escape(g_cfg.tuyaEndpoint, eTuyaEp, sizeof(eTuyaEp));
        snprintf(resp, 65536,
            "{\"mode\":\"%s\",\"samsungTvPaired\":%s,\"config\":{\"samsungTvIp\":\"%s\",\"samsungTvMac\":\"%s\",\"haUrl\":\"%s\",\"tuyaClientId\":\"%s\",\"tuyaEndpoint\":\"%s\"}}",
            g_cfg.mode, (g_cfg.samsungTvPaired && g_cfg.samsungTvIp[0]) ? "true" : "false",
            eSamIp, eSamMac, eHaUrl, eTuyaId, eTuyaEp);
        unlock_state();
        send_json(client, 200, resp);
    }
    else if (strcmp(path, "/api/integrations/tv/wol") == 0 && strcmp(method, "POST") == 0) {
        char mac[32] = {0};
        json_get_string(body, "mac", mac, sizeof(mac));
        if (!mac[0]) { lock_state(); snprintf(mac, sizeof(mac), "%s", g_cfg.samsungTvMac[0] ? g_cfg.samsungTvMac : g_devices[0].mac); unlock_state(); }
        if (send_wake_on_lan(mac)) {
            snprintf(resp, 65536, "{\"ok\":true,\"mac\":\"%s\"}", mac);
            send_json(client, 200, resp);
        } else {
            send_json(client, 400, "{\"error\":\"MAC inválido (use formato AA:BB:CC:DD:EE:FF)\"}");
        }
    }
    else if (strcmp(path, "/api/integrations/test") == 0 && strcmp(method, "POST") == 0) {
        char type[32] = {0};
        json_get_string(body, "type", type, sizeof(type));
        if (strcmp(type, "samsungtv") == 0) {
            char ip[64] = {0}, mac[32] = {0};
            json_get_string(body, "tvIp", ip, sizeof(ip));
            json_get_string(body, "tvMac", mac, sizeof(mac));
            if (!ip[0]) {
                send_json(client, 200, "{\"ok\":false,\"logs\":[\"❌ Informe o IP da sua Samsung Crystal 55\\\" (ex: 192.168.1.51).\"]}");
            } else {
#ifdef _WIN32
                char info_url[128], info_buf[2048] = {0}; int st = 0;
                snprintf(info_url, sizeof(info_url), "http://%s:8001/api/v2/", ip);
                if (winhttp_request(info_url, "GET", NULL, NULL, info_buf, sizeof(info_buf), &st) && st == 200) {
                    if (!mac[0]) json_get_string(info_buf, "wifiMac", mac, sizeof(mac));
                }
                char tok[64] = {0}, err[256] = {0};
                lock_state(); snprintf(tok, sizeof(tok), "%s", g_cfg.samsungTvToken); unlock_state();
                if (samsung_ws_send_keys(ip, tok, sizeof(tok), NULL, 0, err, sizeof(err))) {
                    lock_state();
                    snprintf(g_cfg.samsungTvIp, sizeof(g_cfg.samsungTvIp), "%s", ip);
                    if (mac[0]) snprintf(g_cfg.samsungTvMac, sizeof(g_cfg.samsungTvMac), "%s", mac);
                    if (tok[0]) snprintf(g_cfg.samsungTvToken, sizeof(g_cfg.samsungTvToken), "%s", tok);
                    g_cfg.samsungTvPaired = true;
                    snprintf(g_devices[0].ip, sizeof(g_devices[0].ip), "%s", ip);
                    if (mac[0]) snprintf(g_devices[0].mac, sizeof(g_devices[0].mac), "%s", mac);
                    save_config();
                    add_log("Samsung Crystal 55\" pareada via Wi-Fi!");
                    unlock_state();
                    snprintf(resp, 65536, "{\"ok\":true,\"detectedMac\":\"%s\",\"logs\":[\"✅ Samsung Crystal 55\\\" pareada com sucesso! Token gravado.\",\"💡 Controle remoto, Netflix, YouTube e Wake-on-LAN prontos!\"]}", mac);
                    send_json(client, 200, resp);
                } else {
                    char eErr[384]; json_escape(err, eErr, sizeof(eErr));
                    snprintf(resp, 65536, "{\"ok\":false,\"logs\":[\"❌ %s\"]}", eErr);
                    send_json(client, 200, resp);
                }
#else
                snprintf(resp, 65536, "{\"ok\":true,\"detectedMac\":\"%s\",\"logs\":[\"✅ Simulação POSIX OK para %s\"]}", mac, ip);
                send_json(client, 200, resp);
#endif
            }
        } else if (strcmp(type, "homeassistant") == 0) {
            char url[128] = {0}, tok[256] = {0};
            json_get_string(body, "url", url, sizeof(url));
            json_get_string(body, "token", tok, sizeof(tok));
            if (!url[0] || !tok[0]) {
                send_json(client, 200, "{\"ok\":false,\"logs\":[\"❌ Informe URL (http://IP:8123) e Token de longa duração.\"]}");
            } else {
#ifdef _WIN32
                char api_url[192], hdrs[384], rbuf[1024] = {0}; int st = 0;
                snprintf(api_url, sizeof(api_url), "%s/api/", url);
                snprintf(hdrs, sizeof(hdrs), "Authorization: Bearer %s\r\n", tok);
                if (winhttp_request(api_url, "GET", hdrs, NULL, rbuf, sizeof(rbuf), &st) && st == 200) {
                    send_json(client, 200, "{\"ok\":true,\"logs\":[\"✅ Home Assistant conectado com sucesso na rede local!\"]}");
                } else {
                    snprintf(resp, 65536, "{\"ok\":false,\"logs\":[\"❌ Home Assistant não respondeu (HTTP %d). Verifique IP e Token.\"]}", st);
                    send_json(client, 200, resp);
                }
#else
                send_json(client, 200, "{\"ok\":true,\"logs\":[\"✅ Teste HA OK\"]}");
#endif
            }
        } else if (strcmp(type, "tuya") == 0) {
            char cid[96] = {0}, sec[96] = {0}, ep[128] = {0};
            json_get_string(body, "clientId", cid, sizeof(cid));
            json_get_string(body, "clientSecret", sec, sizeof(sec));
            json_get_string(body, "endpoint", ep, sizeof(ep));
            if (!cid[0] || !sec[0]) {
                send_json(client, 200, "{\"ok\":false,\"logs\":[\"❌ Informe Access ID e Access Secret do iot.tuya.com.\"]}");
            } else {
                char empty_sha[65], sign_hex[65], sign_input[512];
                sha256_hex("", empty_sha, false);
                long long ts_ms = (long long)time(NULL) * 1000LL;
                snprintf(sign_input, sizeof(sign_input), "%s%lldholonet123GET\n%s\n\n/v1.0/token?grant_type=1", cid, ts_ms, empty_sha);
                hmac_sha256_hex(sec, sign_input, sign_hex);
#ifdef _WIN32
                char full_url[256], hdrs[512], rbuf[2048] = {0}; int st = 0;
                snprintf(full_url, sizeof(full_url), "%s/v1.0/token?grant_type=1", ep[0] ? ep : "https://openapi.tuyaus.com");
                snprintf(hdrs, sizeof(hdrs), "client_id: %s\r\nsign: %s\r\nt: %lld\r\nsign_method: HMAC-SHA256\r\nnonce: holonet123\r\n", cid, sign_hex, ts_ms);
                if (winhttp_request(full_url, "GET", hdrs, NULL, rbuf, sizeof(rbuf), &st) && strstr(rbuf, "\"success\":true")) {
                    send_json(client, 200, "{\"ok\":true,\"logs\":[\"✅ Autenticado na Tuya Cloud OpenAPI v2.0 com sucesso!\"]}");
                } else {
                    send_json(client, 200, "{\"ok\":false,\"logs\":[\"❌ Tuya recusou as chaves. Confira Access ID, Secret e Data Center (openapi.tuyaus.com).\"]}");
                }
#else
                snprintf(resp, 65536, "{\"ok\":true,\"logs\":[\"✅ HMAC-SHA256 calculado: %.12s...\"]}", sign_hex);
                send_json(client, 200, resp);
#endif
            }
        } else {
            send_json(client, 200, "{\"ok\":true,\"logs\":[\"ℹ️ Conecte sua Lava e Seca LG ThinQ pelo Home Assistant (thinq.developer.lge.com PAT).\"]}");
        }
    }
    else if (strcmp(path, "/api/integrations/config") == 0 && strcmp(method, "POST") == 0) {
        lock_state();
        json_get_string(body, "mode", g_cfg.mode, sizeof(g_cfg.mode));
        json_get_string(body, "haUrl", g_cfg.haUrl, sizeof(g_cfg.haUrl));
        json_get_string(body, "haToken", g_cfg.haToken, sizeof(g_cfg.haToken));
        json_get_string(body, "tuyaClientId", g_cfg.tuyaClientId, sizeof(g_cfg.tuyaClientId));
        json_get_string(body, "tuyaSecret", g_cfg.tuyaSecret, sizeof(g_cfg.tuyaSecret));
        json_get_string(body, "tuyaEndpoint", g_cfg.tuyaEndpoint, sizeof(g_cfg.tuyaEndpoint));
        save_config();
        unlock_state();
        send_json(client, 200, "{\"ok\":true}");
    }
    else if (strcmp(path, "/api/integrations/ha/sync") == 0 && strcmp(method, "POST") == 0) {
        lock_state();
        json_get_string(body, "url", g_cfg.haUrl, sizeof(g_cfg.haUrl));
        json_get_string(body, "token", g_cfg.haToken, sizeof(g_cfg.haToken));
        strcpy(g_cfg.mode, "homeassistant");
        save_config();
        add_log("Home Assistant ativado para envio de comandos locais.");
        size_t p = (size_t)snprintf(resp, 65536, "{\"ok\":true,\"imported\":%d,\"mode\":\"homeassistant\",\"devices\":[", g_device_count);
        for (int i = 0; i < g_device_count; i++) {
            if (i > 0) resp[p++] = ',';
            p += serialize_device(&g_devices[i], resp + p, 65536 - p);
        }
        snprintf(resp + p, 65536 - p, "]}");
        unlock_state();
        send_json(client, 200, resp);
    }
    else if (strcmp(path, "/api/integrations/reset-demo") == 0 && strcmp(method, "POST") == 0) {
        lock_state();
        strcpy(g_cfg.mode, "demo");
        g_cfg.samsungTvPaired = false;
        init_demo_devices();
        save_config();
        size_t p = (size_t)snprintf(resp, 65536, "{\"ok\":true,\"mode\":\"demo\",\"devices\":[");
        for (int i = 0; i < g_device_count; i++) {
            if (i > 0) resp[p++] = ',';
            p += serialize_device(&g_devices[i], resp + p, 65536 - p);
        }
        snprintf(resp + p, 65536 - p, "]}");
        unlock_state();
        send_json(client, 200, resp);
    }
    /* 11. Arquivos estáticos embutidos no .EXE */
    else {
        const EmbeddedAsset *found = NULL;
        for (int i = 0; EMBEDDED_ASSETS[i].route != NULL; i++) {
            if (strcmp(path, EMBEDDED_ASSETS[i].route) == 0) {
                found = &EMBEDDED_ASSETS[i];
                break;
            }
        }
        if (!found) found = &EMBEDDED_ASSETS[0]; /* SPA fallback */
        send_http(client, 200, found->mime, found->data, found->len);
    }

    free(resp);
    free(req);
    CLOSESOCK(client);
}

#ifdef _WIN32
static unsigned __stdcall client_thread_proc(void *arg) {
    sock_t c = (sock_t)(uintptr_t)arg;
    handle_client(c);
    return 0;
}

static unsigned __stdcall server_accept_loop(void *arg) {
    sock_t srv = (sock_t)(uintptr_t)arg;
    for (;;) {
        sock_t c = accept(srv, NULL, NULL);
        if (c == INVALID_SOCKET) break;
        uintptr_t th = _beginthreadex(NULL, 0, client_thread_proc, (void*)(uintptr_t)c, 0, NULL);
        if (th) CloseHandle((HANDLE)th);
        else CLOSESOCK(c);
    }
    return 0;
}

/* =========================================================================
 * Criação de Atalho .LNK, Auto-Instalação e Bandeja do Sistema (Win32)
 * ========================================================================= */
static void create_shortcut_lnk(const wchar_t *lnk_path, const wchar_t *target_exe, const wchar_t *work_dir) {
    IShellLinkW *psl = NULL;
    if (SUCCEEDED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (LPVOID*)&psl))) {
        psl->lpVtbl->SetPath(psl, target_exe);
        psl->lpVtbl->SetWorkingDirectory(psl, work_dir);
        psl->lpVtbl->SetDescription(psl, L"HOLONET // Comando Residencial Wi-Fi");
        psl->lpVtbl->SetIconLocation(psl, target_exe, 0);
        IPersistFile *ppf = NULL;
        if (SUCCEEDED(psl->lpVtbl->QueryInterface(psl, &IID_IPersistFile, (LPVOID*)&ppf))) {
            ppf->lpVtbl->Save(ppf, lnk_path, TRUE);
            ppf->lpVtbl->Release(ppf);
        }
        psl->lpVtbl->Release(psl);
    }
}

static void open_desktop_window(int port) {
    wchar_t url[128];
    wsprintfW(url, L"http://127.0.0.1:%d", port);

    const wchar_t *browsers[] = {
        L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        L"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        NULL
    };
    wchar_t localAppData[MAX_PATH] = {0};
    SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData);

    for (int i = 0; browsers[i] != NULL; i++) {
        if (GetFileAttributesW(browsers[i]) != INVALID_FILE_ATTRIBUTES) {
            wchar_t cmd[1024];
            wsprintfW(cmd, L"\"%s\" --app=%s --user-data-dir=\"%s\\HOLONET\\WindowProfile\" --window-size=1500,920",
                      browsers[i], url, localAppData);
            STARTUPINFOW si; PROCESS_INFORMATION pi;
            memset(&si, 0, sizeof(si)); si.cb = sizeof(si);
            memset(&pi, 0, sizeof(pi));
            if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
                return;
            }
        }
    }
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

#define WM_TRAYICON (WM_USER + 10)
#define ID_TRAY_OPEN 1001
#define ID_TRAY_AUTOSTART 1002
#define ID_TRAY_UNINSTALL 1003
#define ID_TRAY_EXIT 1004

static NOTIFYICONDATAW g_nid;

static LRESULT CALLBACK TrayWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_TRAYICON) {
        if (lParam == WM_LBUTTONDBLCLK || lParam == WM_LBUTTONUP) {
            open_desktop_window(g_server_port);
        } else if (lParam == WM_RBUTTONUP) {
            POINT pt; GetCursorPos(&pt);
            HMENU hMenu = CreatePopupMenu();
            bool autoOn = win_get_autostart_registry();
            AppendMenuW(hMenu, MF_STRING, ID_TRAY_OPEN, L"Abrir Painel HOLONET");
            AppendMenuW(hMenu, MF_STRING | (autoOn ? MF_CHECKED : MF_UNCHECKED), ID_TRAY_AUTOSTART, L"Iniciar junto com o Windows");
            AppendMenuW(hMenu, MF_SEPARATOR, 0, NULL);
            AppendMenuW(hMenu, MF_STRING, ID_TRAY_UNINSTALL, L"Remover inicializacao e atalhos");
            AppendMenuW(hMenu, MF_STRING, ID_TRAY_EXIT, L"Fechar HOLONET");
            SetForegroundWindow(hwnd);
            TrackPopupMenu(hMenu, TPM_BOTTOMALIGN | TPM_LEFTALIGN, pt.x, pt.y, 0, hwnd, NULL);
            DestroyMenu(hMenu);
        }
        return 0;
    }
    if (msg == WM_COMMAND) {
        int id = LOWORD(wParam);
        if (id == ID_TRAY_OPEN) {
            open_desktop_window(g_server_port);
        } else if (id == ID_TRAY_AUTOSTART) {
            lock_state();
            bool next = !win_get_autostart_registry();
            win_set_autostart_registry(next);
            g_cfg.autostart = next;
            save_config();
            unlock_state();
        } else if (id == ID_TRAY_UNINSTALL) {
            win_set_autostart_registry(false);
            wchar_t path[MAX_PATH];
            if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, path))) {
                wcscat(path, L"\\HOLONET Comando.lnk"); DeleteFileW(path);
            }
            if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, path))) {
                wcscat(path, L"\\HOLONET Comando.lnk"); DeleteFileW(path);
            }
            MessageBoxW(hwnd, L"Inicializacao automatica e atalhos removidos com sucesso.", L"HOLONET", MB_OK | MB_ICONINFORMATION);
            Shell_NotifyIconW(NIM_DELETE, &g_nid);
            PostQuitMessage(0);
        } else if (id == ID_TRAY_EXIT) {
            Shell_NotifyIconW(NIM_DELETE, &g_nid);
            PostQuitMessage(0);
        }
        return 0;
    }
    if (msg == WM_DESTROY) {
        Shell_NotifyIconW(NIM_DELETE, &g_nid);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmd, int nShow) {
    (void)hPrev; (void)lpCmd; (void)nShow;
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

    /* 1) Pasta de instalação %LOCALAPPDATA%\HOLONET */
    wchar_t localApp[MAX_PATH] = {0}, installDir[MAX_PATH] = {0}, targetExe[MAX_PATH] = {0}, curExe[MAX_PATH] = {0};
    SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localApp);
    wsprintfW(installDir, L"%s\\HOLONET", localApp);
    CreateDirectoryW(installDir, NULL);
    wsprintfW(targetExe, L"%s\\HOLONET-Desktop.exe", installDir);
    GetModuleFileNameW(NULL, curExe, MAX_PATH);

    /* Se o usuário acabou de clicar no arquivo baixado em Downloads, instala sozinho e abre! */
    if (_wcsicmp(curExe, targetExe) != 0) {
        CopyFileW(curExe, targetExe, FALSE);
        wchar_t desk[MAX_PATH], startMenu[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, desk))) {
            wcscat(desk, L"\\HOLONET Comando.lnk");
            create_shortcut_lnk(desk, targetExe, installDir);
        }
        if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, startMenu))) {
            wcscat(startMenu, L"\\HOLONET Comando.lnk");
            create_shortcut_lnk(startMenu, targetExe, installDir);
        }
        /* Registra inicialização com o Windows apontando para o executável instalado */
        HKEY hKey;
        if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS) {
            wchar_t runCmd[MAX_PATH + 32];
            wsprintfW(runCmd, L"\"%s\" --autostart", targetExe);
            RegSetValueExW(hKey, L"HOLONET", 0, REG_SZ, (const BYTE*)runCmd, (DWORD)((wcslen(runCmd) + 1) * sizeof(wchar_t)));
            RegCloseKey(hKey);
        }
        STARTUPINFOW si; PROCESS_INFORMATION pi;
        memset(&si, 0, sizeof(si)); si.cb = sizeof(si);
        memset(&pi, 0, sizeof(pi));
        wchar_t launchCmd[MAX_PATH + 8];
        wsprintfW(launchCmd, L"\"%s\"", targetExe);
        if (CreateProcessW(NULL, launchCmd, NULL, NULL, FALSE, 0, NULL, installDir, &si, &pi)) {
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            CoUninitialize();
            return 0;
        }
    }

    WideCharToMultiByte(CP_UTF8, 0, installDir, -1, g_data_dir, sizeof(g_data_dir), NULL, NULL);

    /* 2) Instância única: se já estiver rodando, apenas abre a janela! */
    HANDLE hMutex = CreateMutexW(NULL, FALSE, L"Local\\HOLONET_DESKTOP_SINGLETON_V2");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        char pfile[600]; snprintf(pfile, sizeof(pfile), "%s/port.txt", g_data_dir);
        int port = HOLONET_DEFAULT_PORT;
        FILE *pf = fopen(pfile, "r");
        if (pf) { fscanf(pf, "%d", &port); fclose(pf); }
        open_desktop_window(port);
        if (hMutex) CloseHandle(hMutex);
        CoUninitialize();
        return 0;
    }

    InitializeCriticalSection(&g_lock);
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    load_config();
    init_demo_devices();

    /* 3) Sobe servidor local em 0.0.0.0:3077 (ou porta livre se ocupada) */
    sock_t srv = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(HOLONET_DEFAULT_PORT);
    if (bind(srv, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
        addr.sin_port = 0;
        bind(srv, (struct sockaddr*)&addr, sizeof(addr));
    }
    listen(srv, 32);
    int alen = sizeof(addr);
    getsockname(srv, (struct sockaddr*)&addr, &alen);
    g_server_port = ntohs(addr.sin_port);

    char pfile[600]; snprintf(pfile, sizeof(pfile), "%s/port.txt", g_data_dir);
    FILE *pf = fopen(pfile, "w");
    if (pf) { fprintf(pf, "%d\n", g_server_port); fclose(pf); }

    uintptr_t th = _beginthreadex(NULL, 0, server_accept_loop, (void*)(uintptr_t)srv, 0, NULL);
    if (th) CloseHandle((HANDLE)th);

    /* 4) Ícone na Bandeja do Sistema (System Tray) */
    WNDCLASSW wc;
    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = TrayWndProc;
    wc.hInstance = hInst;
    wc.lpszClassName = L"HOLONET_TRAY_WND";
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"HOLONET", 0, 0, 0, 0, 0, NULL, NULL, hInst, NULL);

    memset(&g_nid, 0, sizeof(g_nid));
    g_nid.cbSize = sizeof(g_nid);
    g_nid.hWnd = hwnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = LoadIconW(hInst, MAKEINTRESOURCEW(1));
    if (!g_nid.hIcon) g_nid.hIcon = LoadIconW(NULL, MAKEINTRESOURCEW(32512));
    wsprintfW(g_nid.szTip, L"HOLONET // Comando Residencial (Porta %d)", g_server_port);
    Shell_NotifyIconW(NIM_ADD, &g_nid);

    /* 5) Abre a janela desktop automaticamente (inclusive quando o PC inicializa!) */
    open_desktop_window(g_server_port);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CLOSESOCK(srv);
    WSACleanup();
    DeleteCriticalSection(&g_lock);
    CloseHandle(hMutex);
    CoUninitialize();
    return 0;
}
#else
/* Modo de teste POSIX no Linux para validar todas as rotas HTTP do binário C! */
int main(int argc, char **argv) {
    int port = (argc > 1) ? atoi(argv[1]) : 0;
    snprintf(g_data_dir, sizeof(g_data_dir), "/tmp");
    load_config();
    init_demo_devices();

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1; setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((uint16_t)port);
    if (bind(srv, (struct sockaddr*)&addr, sizeof(addr)) != 0) return 1;
    listen(srv, 16);
    socklen_t alen = sizeof(addr);
    getsockname(srv, (struct sockaddr*)&addr, &alen);
    g_server_port = ntohs(addr.sin_port);
    printf("POSIX_PORT=%d\n", g_server_port);
    fflush(stdout);

    for (int i = 0; i < 64; i++) {
        int c = accept(srv, NULL, NULL);
        if (c < 0) break;
        handle_client(c);
    }
    close(srv);
    return 0;
}
#endif
