# Stories da Moana 🐾

Arquivos prontos em `stories/` (1080x1920, já na área segura do Instagram).

---

## Ordem de postagem (a sequência que mais converte)

| # | Arquivo | O que é | Quando |
|---|---------|---------|--------|
| 1 | `01-capa-1.jpg` ou `01-capa-2.jpg` | Abertura com a foto dela — escolha a que mais emociona | primeiro |
| 2 | `02-contexto.jpg` | Explica o que aconteceu (piometra = emergência) | em seguida |
| 3 | `03-porque.jpg` | Cria vínculo: "ela confiou em mim" | em seguida |
| 4 | `08-meta.jpg` | Prova de que está andando + barra de progresso | depois de ter algum valor |
| 5 | `04-pix.jpg` | **Conversão 1** — chave Pix | depois das 12h e às 20h |
| 6 | `05-link.jpg` | **Conversão 2** — QR code da vaquinha | junto com o Pix |
| 7 | `06-enquete.jpg` | Engajamento (faz o Instagram entregar mais) | último, no mesmo dia |
| 8 | `07-obrigada.jpg` | Gratidão — poste no dia seguinte e ao final | closing |

> ⚠️ **Não poste os 8 de uma vez.** Poste 3 ou 4 por dia, em horários diferentes.
> Story é como novela: a pessoa precisa ver a Moana mais de uma vez para doar.

---

## Texto para cada story (copie e cole nos adesivos)

**1 — Capa**
> Adesivo de texto: *"essa é a Moana"*
> Música: algo calmo (procure "acoustic calm" ou "sentimental")

**2 — Contexto**
> Adesivo de enquete: **"Você sabia o que é piometra?"** → Sim / Não
> Isso faz a pessoa parar e ler.

**3 — Por que estou pedindo**
> Adesivo de texto: *"ela tem [X] anos e sempre foi minha sombra"* (personalize!)

**4 — Meta**
> Adesivo de contagem regressiva ou adesivo de doação do Instagram (se sua conta tiver)
> Texto: *"falta pouco e cada real conta"*

**5 — Pix**
> **IMPORTANTE:** adicione o adesivo de **link** apontando para a vaquinha também.
> Texto: *"se não puder doar, compartilha — isso também salva"*

**6 — Link**
> Adesivo de link: `vakinha.com.br/6446006`
> Texto: *"aponta a câmera pro código 🤍"*

**7 — Enquete**
> Use o adesivo de ENQUETE de verdade (não a arte pronta) — o nativo entrega mais alcance.
> Pergunta: **"Vou doar 🙋"** / **"Já doei!"**

**8 — Obrigada**
> Marque quem doou (ou poste print do agradecimento nos destaques)

---

## O que mais faz diferença (em ordem de impacto)

1. **Regra dos 3 segundos** — a pessoa decide se doa antes de ler tudo. Por isso a capa é só a foto dela + o nome.
2. **Peça valor baixo.** "R$ 5" converte muito mais que "ajude como puder". Quem quer dar mais, dá.
3. **Link + Pix no mesmo story.** Quem está no impulso doa pelo Pix; quem quer ver a vaquinha clica no link.
4. **Responda TODO mundo que mandar DM**, mesmo que seja só um ❤️. Cada resposta sua puxa o story de volta pro topo.
5. **Reposte a prova.** Print do "R$ 850 de R$ 3.000" subindo → gatilho de prova social. Regenere o `08-meta.jpg` conforme o valor sobe.
6. **Poste nos horários**: 12h–13h e 19h–21h.
7. **Fixe nos destaques** com o nome "Moana 🐾" e capinha fofa.

---

## Falta preencher (me passe e eu atualizo)

- [ ] **Chave Pix** — hoje está `sua chave aqui` no `04-pix.jpg`
- [ ] **Meta e valor arrecadado** — hoje está R$ 850 de R$ 3.000 (chute meu)
- [ ] **Idade/nome completo dela**, se quiser personalizar o texto do story 3

---

## Como regenerar

```bash
cd campanha-moana
pip install Pillow numpy qrcode fonttools brotli

python3 gerar_stories.py \
  --pix "sua-chave-pix" \
  --meta 3000 \
  --arrecadado 850
```

Opções:
- `--foco 0.5` → muda o recorte da foto da capa (0 = topo, 1 = base). Use se o rosto dela ficar cortado.
- `--link` / `--rotulo` → outro endereço da vaquinha
- Sem `--meta` → não gera o story de progresso

As fotos originais ficam em `_ref/` — troque por outras e rode de novo.
`contato-todos.jpg` é só uma folha de contato para você ver tudo de uma vez (não poste).
