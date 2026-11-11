#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador de stories (1080x1920) para a vaquinha da Moana.
Tom: fofo, leve e acolhedor.

Uso:
    python3 gerar_stories.py
    python3 gerar_stories.py --meta 3000 --arrecadado 850 --pix "sua-chave-pix"
"""

import argparse
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920

ROOT = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(os.path.dirname(ROOT), '.tools', 'fonts')
OUT = os.path.join(ROOT, 'stories')
REF = os.path.join(ROOT, '_ref')

INK = (74, 58, 56)
INK2 = (126, 106, 103)
WHITE = (255, 255, 255)
CORAL = (240, 122, 106)
CORAL_D = (206, 84, 70)
ROSE = (255, 202, 193)

# area segura do Instagram
SAFE_TOP = 300
SAFE_BOT = H - 360          # 1560

PALETTES = {
    'creme': [(255, 248, 243), (255, 231, 219)],
    'rosa':  [(255, 245, 242), (255, 210, 201)],
    'menta': [(245, 252, 249), (198, 234, 224)],
    'lilas': [(251, 248, 255), (224, 213, 250)],
    'areia': [(255, 252, 245), (250, 231, 201)],
}


# ------------------------------------------------------------------ fontes

def fnt(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


N = lambda s: fnt('nunito-latin-{}-normal.ttf'.format(s), 0) and None  # noqa: E731


def F(weight, size):
    return fnt('nunito-latin-{}-normal.ttf'.format(weight), size)


def M(weight, size):
    return fnt('montserrat-latin-{}-normal.ttf'.format(weight), size)


# ------------------------------------------------------------------ fundo

def base(pal):
    top, bot = PALETTES[pal]
    img = Image.new('RGBA', (W, H), top + (255,))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)],
               fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    return img


def blob(img, cx, cy, r, color, alpha=90):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(40, 0, -1):
        rr = r * i / 40
        a = int(alpha * ((1 - i / 40) ** 1.5))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color + (a,))
    img.alpha_composite(layer)


def grain(img, sigma=7, op=0.045):
    n = Image.effect_noise((W, H), sigma).convert('L')
    n = Image.merge('RGB', (n, n, n)).convert('RGBA')
    return Image.blend(img, n, op)


def decor(img, seed=0):
    if seed % 3 == 0:
        blob(img, 110, 420, 300, CORAL, 40)
        blob(img, 980, 1500, 340, CORAL, 34)
        paw(img, 920, 640, 88, CORAL, 60)
        heart(img, 170, 1560, 72, CORAL, 70)
    elif seed % 3 == 1:
        blob(img, 970, 500, 320, CORAL, 38)
        blob(img, 120, 1480, 300, CORAL, 32)
        heart(img, 940, 880, 64, CORAL, 60)
        paw(img, 165, 700, 84, CORAL, 55)
    else:
        blob(img, 540, 230, 380, CORAL, 30)
        blob(img, 110, 1600, 300, CORAL, 34)
        heart(img, 950, 1520, 68, CORAL, 65)
        paw(img, 195, 520, 80, CORAL, 55)


def panel(img, box, radius=54, fill=WHITE, shadow=True):
    if shadow:
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle(
            [box[0] + 10, box[1] + 18, box[2] + 10, box[3] + 18],
            radius=radius, fill=(105, 74, 72, 70))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)))
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(lay).rounded_rectangle(box, radius=radius, fill=tuple(fill) + (255,))
    img.alpha_composite(lay)


# ------------------------------------------------------------------ formas

def heart(img, cx, cy, s, color, alpha=255):
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    r = s * 0.36
    for dx in (-0.25, 0.25):
        d.ellipse([cx + s * dx - r, cy - s * 0.22 - r,
                   cx + s * dx + r, cy - s * 0.22 + r], fill=color + (alpha,))
    d.polygon([(cx - s * 0.52, cy - s * 0.14), (cx + s * 0.52, cy - s * 0.14),
               (cx, cy + s * 0.62)], fill=color + (alpha,))
    img.alpha_composite(lay)


def paw(img, cx, cy, s, color, alpha=255):
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    c = color + (alpha,)
    tr = s * 0.17
    for dx, dy in [(-0.36, -0.10), (-0.13, -0.30), (0.13, -0.30), (0.36, -0.10)]:
        x, y = cx + s * dx, cy + s * dy
        d.ellipse([x - tr, y - tr * 1.25, x + tr, y + tr * 1.25], fill=c)
    d.ellipse([cx - s * 0.32, cy - s * 0.02, cx + s * 0.32, cy + s * 0.46], fill=c)
    img.alpha_composite(lay)


# ------------------------------------------------------------------ texto

def wrap(d, text, font, maxw):
    out = []
    for seg in text.split('\n'):
        cur = ''
        for w in seg.split(' '):
            t = (cur + ' ' + w).strip()
            if not cur or d.textbbox((0, 0), t, font=font)[2] <= maxw:
                cur = t
            else:
                out.append(cur)
                cur = w
        out.append(cur)
    return out


def spaced(d, cx, y, text, font, fill, sp=5):
    chars = list(text.upper())
    widths = [d.textbbox((0, 0), c, font=font)[2] for c in chars]
    total = sum(widths) + sp * (len(chars) - 1)
    px = cx - total / 2
    for c, w in zip(chars, widths):
        d.text((px, y), c, font=font, fill=tuple(fill) + (255,))
        px += w + sp
    return total


def pill_wh(d, text, font, padx, pady):
    bb = d.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0] + padx * 2, bb[3] - bb[1] + pady * 2


def draw_pill(img, cx, cy, text, font, bg, fg, padx=54, pady=28, shadow=True):
    d = ImageDraw.Draw(img)
    w, h = pill_wh(d, text, font, padx, pady)
    box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    if shadow:
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle(
            [box[0] + 6, box[1] + 12, box[2] + 6, box[3] + 12],
            radius=h / 2, fill=(200, 90, 80, 90))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    d.rounded_rectangle(box, radius=h / 2, fill=bg)
    d.text((cx, cy), text, font=font, fill=fg, anchor='mm')
    return h


def fit_font(family, weight, size, text, maxw, padx=54, pady=28, min_size=22):
    """Reduz a fonte ate o texto caber na largura util."""
    while size > min_size:
        font = (M(weight, size) if family == 'm' else F(weight, size))
        d = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
        if pill_wh(d, text, font, padx, pady)[0] <= maxw:
            break
        size -= 2
    return (M(weight, size) if family == 'm' else F(weight, size))


def enhance(ph, focus=0.35):
    """Tratamento leve: clareia se estiver escura, aquece e suaviza.

    Deixa fotos de celular (escuras, frias, contrastadas) com o mesmo
    clima pastel do resto do story.
    """
    a = np.asarray(ph.convert('RGB')).astype(np.float32)

    lum = float(a.mean())
    target = 142.0
    gain = min(target / max(lum, 1.0), 2.6) if lum < target else 1.0 + (target - lum) / lum * 0.45
    a = np.clip(a * gain, 0, 255)

    # levanta as sombras (gamma < 1) sem estourar os brancos
    a = 255.0 * np.power(a / 255.0, 0.86)

    # curva em S suave para nao ficar lavado
    a = np.clip(a + (a - 128.0) * 0.10, 0, 255)

    # tom quente
    a[..., 0] = np.clip(a[..., 0] * 1.05, 0, 255)
    a[..., 2] = np.clip(a[..., 2] * 0.955, 0, 255)

    # leve "fade" cremoso
    a = np.clip(a * 0.94 + np.array([255.0, 246.0, 238.0]) * 0.06, 0, 255)
    return Image.fromarray(a.astype(np.uint8))


def qrcode_img(text, size, fg=INK):
    import qrcode
    qr = qrcode.QRCode(box_size=12, border=2,
                       error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(text)
    qr.make(fit=True)
    im = qr.make_image(fill_color=fg, back_color='white').convert('RGBA').resize(
        (size, size), Image.NEAREST)
    px = im.load()
    for y in range(size):
        for x in range(size):
            r, g, b, _a = px[x, y]
            if r > 240 and g > 240 and b > 240:
                px[x, y] = (0, 0, 0, 0)
    return im


# ------------------------------------------------------------------ blocos

def T(text, weight=600, size=48, lh=None, fill=INK2, maxw=800, family='n'):
    return dict(t='text', text=text, weight=weight, size=size,
                lh=lh or int(size * 1.45), fill=fill, maxw=maxw, family=family)


def KICK(text, size=32, fill=CORAL, sp=5):
    return dict(t='kicker', text=text, size=size, fill=fill, sp=sp, h=int(size * 1.4))


def SP(h):
    return dict(t='space', h=h)


def SHAPE(kind, size, color=CORAL, alpha=220):
    return dict(t='shape', kind=kind, size=size, h=int(size * 1.45),
                color=color, alpha=alpha)


def PILL(text, bg=CORAL, fg=WHITE, weight=700, size=46, family='m', maxw=880):
    return dict(t='pill', text=text, bg=bg, fg=fg, weight=weight, size=size,
                family=family, maxw=maxw)


def BAR(pct, w=760, h=56):
    return dict(t='bar', pct=pct, w=w, h=h)


def QR(link, size=380):
    return dict(t='qr', link=link, size=size, h=size + 40)


def flow(img, blocks, top, bottom, cx=W // 2):
    """Distribui os blocos verticalmente, centralizados entre top e bottom."""
    d = ImageDraw.Draw(img)
    items, total = [], 0
    for b in blocks:
        if b['t'] in ('space', 'kicker'):
            h = b['h']
        elif b['t'] == 'shape':
            h = b['h']
        elif b['t'] == 'bar':
            h = b['h']
        elif b['t'] == 'qr':
            h = b['h']
        elif b['t'] == 'pill':
            padx, pady = 54, 28
            font = fit_font(b['family'], b['weight'], b['size'], b['text'], b['maxw'], padx, pady)
            h = pill_wh(d, b['text'], font, padx, pady)[1] + 16
            b = dict(b, font=font, h=h)
        else:
            lines = wrap(d, b['text'],
                         (M(b['weight'], b['size']) if b['family'] == 'm'
                          else F(b['weight'], b['size'])), b['maxw'])
            h = len(lines) * b['lh']
            b = dict(b, lines=lines)
        items.append(b)
        total += h

    if total > (bottom - top) + 1:
        raise ValueError('conteudo ({}) nao cabe em {}..{} ({})'.format(
            total, top, bottom, bottom - top))

    y = top + (bottom - top - total) / 2
    for b in items:
        if b['t'] == 'space':
            y += b['h']
        elif b['t'] == 'kicker':
            spaced(d, cx, y + 6, b['text'], F(800, b['size']), b['fill'], b['sp'])
            y += b['h']
        elif b['t'] == 'shape':
            (heart if b['kind'] == 'heart' else paw)(
                img, cx, y + b['h'] / 2, b['size'], b['color'], b['alpha'])
            y += b['h']
        elif b['t'] == 'bar':
            bx, by, bw, bh = cx - b['w'] / 2, y, b['w'], b['h']
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(lay).rounded_rectangle(
                [bx, by, bx + bw, by + bh], radius=bh / 2, fill=(255, 255, 255, 255))
            img.alpha_composite(lay)
            fw = max(int(bw * min(b['pct'], 1.0)), bh)
            ImageDraw.Draw(img).rounded_rectangle(
                [bx, by, bx + fw, by + bh], radius=bh / 2, fill=CORAL + (255,))
            y += b['h']
        elif b['t'] == 'qr':
            box = b['size'] + 60
            holder = Image.new('RGBA', (box, box), (0, 0, 0, 0))
            ImageDraw.Draw(holder).rounded_rectangle(
                [0, 0, box, box], radius=44, fill=(255, 255, 255, 255))
            holder.alpha_composite(qrcode_img(b['link'], b['size']), (30, 30))
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            lay.alpha_composite(holder, (int(cx - box / 2), int(y)))
            img.alpha_composite(lay)
            y += b['h']
        elif b['t'] == 'pill':
            draw_pill(img, cx, y + b['h'] / 2, b['text'], b['font'], b['bg'], b['fg'])
            y += b['h']
        else:
            font = (M(b['weight'], b['size']) if b['family'] == 'm'
                    else F(b['weight'], b['size']))
            for ln in b['lines']:
                lw = d.textbbox((0, 0), ln, font=font)[2]
                if lw > b['maxw'] + 2:
                    raise ValueError('linha estoura a largura: ' + ln)
                d.text((cx - lw / 2, y), ln, font=font, fill=tuple(b['fill']) + (255,))
                y += b['lh']
    return y


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    img.convert('RGB').save(path, quality=95)
    print('  ->', path)


# ------------------------------------------------------------------ cards

PH_H = 930                      # altura da foto na capa
PANEL = [70, 400, W - 70, SAFE_BOT - 20]   # 400 .. 1540


def card_capa(foto, nome, foco=0.35):
    img = base('creme')
    decor(img, 0)

    ph = enhance(Image.open(foto).convert('RGB'))
    fw, fh = W, PH_H
    ar_src, ar_dst = ph.width / ph.height, fw / fh
    if ar_src > ar_dst:
        nw = int(ph.height * ar_dst)
        ph = ph.crop(((ph.width - nw) // 2, 0, (ph.width + nw) // 2, ph.height))
    else:
        nh = int(ph.width / ar_dst)
        top = int(min(max((ph.height - nh) * foco, 0), ph.height - nh))
        ph = ph.crop((0, top, ph.width, top + nh))
    ph = ph.resize((fw, fh), Image.LANCZOS)

    m = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(m)
    md.rounded_rectangle([0, -70, W, fh], radius=64, fill=255)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(ph, (0, 0))
    layer.putalpha(m)
    img.alpha_composite(layer)

    # fade da foto para o fundo
    grad = Image.new('RGBA', (W, 220), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(220):
        gd.line([(0, y), (W, y)], fill=(255, 246, 240, int(170 * (y / 220))))
    img.alpha_composite(grad, (0, fh - 220))

    # selo sobre a foto
    bx, by, bw, bh = 300, 340, 480, 86
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(lay).rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh / 2,
                                          fill=(255, 255, 255, 235))
    img.alpha_composite(lay)
    spaced(ImageDraw.Draw(img), W / 2, by + 26, 'vaquinha aberta',
           F(800, 32), CORAL, 4)

    ptop, pbot = fh + 30, SAFE_BOT - 10
    panel(img, [70, ptop, W - 70, pbot])
    flow(img, [
        T('Moana', 900, 122, lh=134, fill=INK, maxw=900),
        SP(14),
        T('operou de piometra e\nestá se recuperando', 600, 44, lh=62, fill=INK2, maxw=780),
        SP(26),
        T('a gente ainda está\nse reorganizando', 700, 40, lh=56, fill=INK, maxw=800),
    ], ptop + 70, pbot - 70)
    return save(img, nome)


def _base_card(pal, seed):
    img = base(pal)
    decor(img, seed)
    return grain(img)


def card_contexto():
    img = _base_card('rosa', 1)
    panel(img, PANEL)
    flow(img, [
        KICK('o que aconteceu'),
        SP(40),
        T('Cirurgia de\nemergência\nnão avisa.', 900, 100, lh=116, fill=INK, maxw=840),
        SP(34),
        SHAPE('heart', 80, ROSE, 235),
        SP(34),
        T('A gente só fez o que\nprecisava ser feito.\nE faria de novo, mil vezes.',
          600, 48, lh=72, maxw=800),
    ], PANEL[1] + 90, PANEL[3] - 90)
    return save(img, '02-contexto.jpg')


def card_porque():
    img = _base_card('menta', 2)
    panel(img, PANEL)
    flow(img, [
        KICK('por que estou pedindo', 30),
        SP(40),
        T('Ela não escolheu\nficar doente.', 900, 96, lh=112, fill=INK, maxw=860),
        SP(34),
        SHAPE('paw', 82, CORAL, 130),
        SP(34),
        T('Mas escolheu confiar em mim.\nE eu escolhi não desistir dela.',
          600, 48, lh=72, maxw=800),
    ], PANEL[1] + 90, PANEL[3] - 90)
    return save(img, '03-porque.jpg')


def card_pix(pix):
    img = _base_card('creme', 0)
    panel(img, PANEL)
    flow(img, [
        KICK('como ajudar'),
        SP(38),
        T('Se puder,\nme ajuda?', 900, 104, lh=120, fill=INK, maxw=860),
        SP(36),
        T('Qualquer valor já faz diferença:\nR$ 5, R$ 10, o que sair do coração.',
          600, 48, lh=72, maxw=800),
        SP(52),
        PILL('Pix:  ' + pix, size=44),
        SP(40),
        T('obrigada por cuidar dela comigo', 700, 40, lh=54, fill=INK, maxw=860),
    ], PANEL[1] + 80, PANEL[3] - 80)
    return save(img, '04-pix.jpg')


def card_link(link, rotulo):
    img = _base_card('lilas', 1)
    panel(img, PANEL)
    flow(img, [
        KICK('ou pela vaquinha'),
        SP(34),
        T('Um clique\ntambém salva.', 900, 96, lh=112, fill=INK, maxw=860),
        SP(38),
        QR(link, 360),
        SP(30),
        T(rotulo, 700, 40, lh=52, fill=INK, maxw=880, family='m'),
        SP(14),
        T('arrasta pra cima ou link na bio', 600, 38, lh=50, maxw=860),
    ], PANEL[1] + 70, PANEL[3] - 70)
    return save(img, '05-link.jpg')


def card_enquete():
    img = _base_card('areia', 2)
    panel(img, PANEL)
    flow(img, [
        KICK('me ajuda aqui?'),
        SP(40),
        T('Esse story\nchegou em você?', 900, 94, lh=110, fill=INK, maxw=860),
        SP(56),
        PILL('Vou doar', bg=CORAL, fg=WHITE, weight=800, size=52, family='n'),
        SP(26),
        PILL('Já doei!', bg=WHITE, fg=CORAL_D, weight=800, size=52, family='n'),
        SP(44),
        T('responder ajuda MUITO o alcance', 600, 38, lh=50, maxw=860),
    ], PANEL[1] + 80, PANEL[3] - 80)
    return save(img, '06-enquete.jpg')


def card_obrigada():
    img = _base_card('rosa', 0)
    panel(img, PANEL)
    flow(img, [
        T('Obrigada.', 900, 112, lh=132, fill=INK, maxw=900),
        SP(34),
        SHAPE('heart', 82, ROSE, 235),
        SP(34),
        T('Cada doação, cada\ncompartilhada, cada\n“melhoras, Moana”…',
          600, 50, lh=76, maxw=820),
        SP(32),
        T('a gente guarda tudinho\ncom carinho', 800, 50, lh=68, fill=INK, maxw=820),
    ], PANEL[1] + 90, PANEL[3] - 90)
    return save(img, '07-obrigada.jpg')


def card_meta(arrecadado, meta):
    pct = arrecadado / meta if meta else 0
    valor = 'R$ {:,.0f} de R$ {:,.0f}'.format(arrecadado, meta).replace(',', '.')
    img = _base_card('menta', 1)
    panel(img, PANEL)
    flow(img, [
        KICK('de olho na meta'),
        SP(40),
        T(valor, 800, 64, lh=82, fill=INK, maxw=880, family='m'),
        SP(40),
        BAR(pct),
        SP(36),
        T('{:.0f}%'.format(pct * 100), 800, 60, lh=78, fill=CORAL, maxw=880, family='m'),
        SP(32),
        T('falta pouco — e cada\nreal conta muito', 700, 48, lh=66, fill=INK, maxw=820),
        SP(30),
        SHAPE('paw', 70, CORAL, 130),
    ], PANEL[1] + 80, PANEL[3] - 80)
    return save(img, '08-meta.jpg')


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pix', default='sua chave pix')
    ap.add_argument('--link', default='https://www.vakinha.com.br/6446006')
    ap.add_argument('--rotulo', default='vakinha.com.br/6446006')
    ap.add_argument('--meta', type=float, default=None)
    ap.add_argument('--arrecadado', type=float, default=0)
    ap.add_argument('--foco', type=float, default=0.35,
                    help='0 = topo da foto, 1 = base (recorte da capa)')
    a = ap.parse_args()

    print('gerando stories...')
    os.makedirs(REF, exist_ok=True)
    fotos = sorted(
        os.path.join(REF, p) for p in os.listdir(REF)
        if p.lower().endswith(('.jpg', '.jpeg', '.png')) and not p.startswith('.')
    )
    for i, foto in enumerate(fotos):
        card_capa(foto, '01-capa-{}.jpg'.format(i + 1), a.foco)

    card_contexto()
    card_porque()
    card_pix(a.pix)
    card_link(a.link, a.rotulo)
    card_enquete()
    card_obrigada()
    if a.meta:
        card_meta(a.arrecadado, a.meta)

    montagem()
    print('pronto!')


def montagem(cols=4, thumb_w=300):
    """Gera uma folha de contato para visualizar todos de uma vez."""
    files = sorted(p for p in os.listdir(OUT) if p.lower().endswith('.jpg'))
    if not files:
        return
    tw = thumb_w
    th = int(tw * H / W)
    rows = (len(files) + cols - 1) // cols
    pad, label = 26, 34
    sheet = Image.new('RGB', (cols * tw + pad * (cols + 1),
                              rows * (th + label) + pad * (rows + 1)), (242, 238, 235))
    d = ImageDraw.Draw(sheet)
    for i, fn in enumerate(files):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = pad + r * (th + label + pad)
        im = Image.open(os.path.join(OUT, fn)).resize((tw, th), Image.LANCZOS)
        sheet.paste(im, (x, y))
        d.text((x, y + th + 8), fn.replace('.jpg', ''), font=F(700, 22), fill=INK)
    path = os.path.join(OUT, '..', 'contato-todos.jpg')
    sheet.save(path, quality=92)
    print('  ->', os.path.normpath(path))


if __name__ == '__main__':
    main()
