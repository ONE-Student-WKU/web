"""학교 문의문 md → HTML(→ PDF).

docs/school-inquiry/학교문의_발송용.md(이슈 #332 본문과 같은 원문)를 읽어 인쇄용 HTML을 만들고,
--pdf를 주면 Chrome으로 PDF까지 뽑는다. 원문은 md 하나만 고치고 HTML·PDF는 이 스크립트로 다시 만든다.

보내는 사람의 이름·연락처는 저장소가 공개라 md·HTML에 쓰지 않는다. 실제로 보낼 PDF는
--contact로 넘기고 출력 경로를 저장소 밖(커밋하지 않는 곳)으로 준다.

  python scripts/docs/buildSchoolInquiry.py --pdf
  python scripts/docs/buildSchoolInquiry.py --pdf --contact "이름 · 전화 · 메일" --out-dir <저장소 밖 폴더>
  python scripts/docs/buildSchoolInquiry.py --pdf --src docs/school-inquiry/학교문의_후속_발송용.md --name 학교문의_후속_2026-10-14
"""
import argparse
import html
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'docs', 'school-inquiry', '학교문의_발송용.md')
NAME = '학교문의_2026-10-12'
CONTACT_BLANK = '(이름 · 연락처: ______)'
CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
]

CSS = """
@page { size: A4; margin: 18mm 17mm 20mm 17mm;
  @bottom-center { content: counter(page) " / " counter(pages); font: 9pt "Noto Sans KR", "Malgun Gothic", sans-serif; color: #888; } }
@page :first { @bottom-center { content: none; } }
:root { --ink:#1f2933; --muted:#5f6b7a; --line:#d9dee5; --soft:#f4f6f9; --accent:#1f4e8c; --accent-soft:#e8eff8; --warn-soft:#fff6e5; --warn-line:#f0c36d; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Noto Sans KR", "Malgun Gothic", sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.72; margin: 0; word-break: keep-all; overflow-wrap: break-word; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
.cover-top { margin-top: 38mm; }
.cover .kicker { color: var(--accent); font-weight: 700; letter-spacing: .08em; }
.cover h1 { font-size: 25pt; line-height: 1.35; margin: 10px 0 14px; font-weight: 800; }
.cover .sub { font-size: 12pt; color: var(--muted); margin: 0; }
.cover .to { margin-top: 26mm; border-top: 2px solid var(--accent); padding-top: 14px; }
.cover .to table { border: none; width: auto; }
.cover .to td { border: none; padding: 3px 18px 3px 0; font-size: 11pt; vertical-align: top; }
.cover .to td:first-child { color: var(--muted); width: 26mm; white-space: nowrap; }
.cover-bottom { font-size: 9.5pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 10px; }
h2.part { page-break-before: always; font-size: 17pt; margin: 0 0 4px; color: var(--accent); border-bottom: 3px solid var(--accent); padding-bottom: 8px; }
.part-desc { color: var(--muted); margin: 6px 0 18px; }
h2.plain { font-size: 15pt; margin: 0 0 10px; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 6px; }
h3 { font-size: 12.5pt; margin: 16px 0 8px; }
p { margin: 0 0 8px; }
ul, ol { margin: 4px 0 10px; padding-left: 20px; }
li { margin: 2px 0; }
.muted { color: var(--muted); }
.q { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px 12px; margin: 0 0 16px; break-inside: avoid; }
.q.long { break-inside: auto; }
.q-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.q-no { background: var(--accent); color: #fff; font-weight: 700; font-size: 9.5pt; border-radius: 4px; padding: 1px 8px; white-space: nowrap; }
.q-title { font-size: 12.5pt; font-weight: 700; }
.badge-key { background: #c2410c; color: #fff; font-size: 8.5pt; border-radius: 4px; padding: 1px 6px; font-weight: 700; white-space: nowrap; }
blockquote { margin: 6px 0 10px; padding: 8px 12px; background: var(--soft); border-left: 3px solid #9aa7b8; font-size: 10pt; }
blockquote p { margin: 0 0 4px; }
.ask { background: var(--warn-soft); border: 1px solid var(--warn-line); border-radius: 6px; padding: 8px 12px 8px 30px; margin: 8px 0 6px; }
.answer { border: 1px dashed #9aa7b8; border-radius: 6px; min-height: 22mm; padding: 6px 10px; margin-top: 8px; color: #8a96a6; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9.6pt; }
tr { break-inside: avoid; }
th, td { border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; text-align: left; }
th { background: var(--soft); font-weight: 700; }
td.check { width: 22mm; }
.box { background: var(--accent-soft); border-radius: 8px; padding: 12px 16px; margin: 0 0 14px; }
.box h3 { color: var(--accent); margin-top: 0; }
.toc { list-style: none; padding-left: 4px; }
.toc li { margin: 3px 0; }
.toc .grp { font-weight: 700; margin-top: 10px; color: var(--accent); }
.toc li:not(.grp) { padding-left: 14px; }
.principle { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 14px; }
.principle > div { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.principle .t { font-weight: 700; margin-bottom: 4px; }
.principle .other { background: var(--soft); }
.principle .wku { background: var(--accent-soft); border-color: #b7c9e2; }
.deptlist { columns: 2; column-gap: 28px; font-size: 9.6pt; padding-left: 30px; }
.appendix { font-size: 9.8pt; line-height: 1.6; }
.appendix table { font-size: 9.2pt; }
.appendix th, .appendix td { padding: 4px 7px; }
td.num { white-space: nowrap; }
.deptlist li { break-inside: avoid; }
"""

CHECK_HEADERS = ('맞나요', '맞는 쪽')
ANSWER_LABELS = ('답변:', '추가로 알려 주실 내용:')


def inline(text):
    """굵게(**)와 코드(`)만 쓰는 md라 이 둘만 변환한다. 나머지는 글자 그대로."""
    t = html.escape(text, quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`([^`]+)`', r'\1', t)
    return t


def split_row(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def render_table(lines):
    head = split_row(lines[0])
    rows = [split_row(l) for l in lines[2:]]
    check_cols = {i for i, h in enumerate(head) if any(k in h for k in CHECK_HEADERS)}
    out = ['<table>', '<tr>' + ''.join(f'<th>{inline(h)}</th>' for h in head) + '</tr>']
    for r in rows:
        cells = []
        for i, c in enumerate(r):
            cls = ' class="check"' if i in check_cols else ' class="num"' if re.fullmatch(r'\d{4}학년도 책자까지', c) else ''
            cells.append(f'<td{cls}>{inline(c)}</td>')
        out.append('<tr>' + ''.join(cells) + '</tr>')
    out.append('</table>')
    return '\n'.join(out)


def render_blocks(lines):
    """문단·인용·표·목록·답변란을 HTML로. 빈 줄로 블록을 나눈다."""
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith('|'):
            j = i
            while j < len(lines) and lines[j].strip().startswith('|'):
                j += 1
            out.append(render_table(lines[i:j]))
            i = j
        elif s.startswith('>'):
            j, paras, cur = i, [], []
            while j < len(lines) and lines[j].strip().startswith('>'):
                body = lines[j].strip()[1:].strip()
                if body:
                    cur.append(inline(body))
                elif cur:
                    paras.append(' '.join(cur)); cur = []
                j += 1
            if cur:
                paras.append(' '.join(cur))
            out.append('<blockquote>' + ''.join(f'<p>{p}</p>' for p in paras) + '</blockquote>')
            i = j
        elif re.match(r'\d+\. ', s):
            j = i
            items = []
            while j < len(lines) and re.match(r'\d+\. ', lines[j].strip()):
                items.append(re.sub(r'^\d+\. ', '', lines[j].strip()))
                j += 1
            out.append('<ol class="ask">' + ''.join(f'<li>{inline(t)}</li>' for t in items) + '</ol>')
            i = j
        elif s.startswith('- '):
            j = i
            items = []
            while j < len(lines) and lines[j].strip().startswith('- '):
                items.append(lines[j].strip()[2:])
                j += 1
            out.append('<ul>' + ''.join(f'<li>{inline(t)}</li>' for t in items) + '</ul>')
            i = j
        elif s.startswith('**') and s.strip('*').strip() in ANSWER_LABELS:
            out.append(f'<div class="answer">{html.escape(s.strip("*").strip().rstrip(":"))}</div>')
            i += 1
        else:
            j = i
            buf = []
            while j < len(lines) and lines[j].strip() and not re.match(r'(\||>|- |\d+\. )', lines[j].strip()):
                buf.append(lines[j].strip())
                j += 1
            out.append(f'<p>{inline(" ".join(buf))}</p>')
            i = j
    return '\n'.join(out)


def parse(md):
    """md를 (종류, 제목, 본문 줄) 구간으로 나눈다. 맨 위 내부 메모(첫 '# ' 앞)는 버린다."""
    lines = md.replace('\r\n', '\n').split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('# '))
    sections, cur = [], None
    for l in lines[start:]:
        if l.strip() == '---':
            continue
        m1 = re.match(r'^# (.+)', l)
        m2 = re.match(r'^## (.+)', l)
        m3 = re.match(r'^### (.+)', l)
        if m1 or m2 or m3:
            level = 1 if m1 else 2 if m2 else 3
            cur = {'level': level, 'title': (m1 or m2 or m3).group(1).strip(), 'lines': []}
            sections.append(cur)
        elif cur is not None:
            cur['lines'].append(l)
    return sections


def render(md, contact=None):
    secs = parse(md)
    body = []

    # 표지: 첫 '# ' 구간
    cover = secs.pop(0)
    cl = [l for l in cover['lines']]
    sub = next(l.strip() for l in cl if l.strip() and not l.strip().startswith(('|', '>')))
    rows = [split_row(l) for l in cl if l.strip().startswith('|')][2:]
    note = ' '.join(l.strip()[1:].strip() for l in cl if l.strip().startswith('>'))
    trs = []
    for k, v in rows:
        if contact and CONTACT_BLANK in v:
            v = v.replace(CONTACT_BLANK, '').strip()
            trs.append(f'<tr><td>{inline(k)}</td><td>{inline(v)}</td></tr>')
            trs.append(f'<tr><td>연락처</td><td>{inline(contact)}</td></tr>')
            continue
        trs.append(f'<tr><td>{inline(k)}</td><td>{inline(v)}</td></tr>')
    title = cover['title']
    title_html = inline(title).replace(' — ', '<br>')
    body.append(f'''<section class="cover"><div class="cover-top">
<div class="kicker">교육과정 · 졸업요건 문의</div>
<h1>{title_html}</h1><p class="sub">{inline(sub)}</p>
<div class="to"><table>{''.join(trs)}</table></div></div>
<div class="cover-bottom">{inline(note)}</div></section>''')

    # 목차는 md의 목록 대신 실제 제목에서 만든다(제목을 고치면 목차도 따라온다).
    toc = []
    for s in secs:
        if s['level'] == 1:
            toc.append(f'<li class="grp">{inline(s["title"])}</li>')
        elif s['level'] == 2 and re.match(r'[A-D]-\d', s['title']):
            toc.append(f'<li>{inline(s["title"])}</li>')

    in_appendix = False
    for s in secs:
        t, lines = s['title'], s['lines']
        if s['level'] == 1 and in_appendix:
            body.append('</div>')
            in_appendix = False
        if s['level'] == 1:
            first = next((l.strip() for l in lines if l.strip()), '')
            rest = lines[lines.index(next(l for l in lines if l.strip() == first)) + 1:] if first else []
            body.append(f'<h2 class="part">{inline(t)}</h2>')
            if t.startswith('부록'):
                body.append('<div class="appendix">')
                in_appendix = True
            if first and not first.startswith(('|', '-', '>')):
                body.append(f'<p class="part-desc">{inline(first)}</p>')
                body.append(render_blocks(rest))
            else:
                body.append(render_blocks(lines))
        elif s['level'] == 2:
            m = re.match(r'([A-D]-\d)\. (.+)', t)
            if m:
                no, qt = m.groups()
                badge = ''
                if '(가장 중요)' in qt:
                    qt = qt.replace('(가장 중요)', '').strip()
                    badge = '<span class="badge-key">가장 중요</span>'
                content = render_blocks(lines)
                cls = 'q long' if len(content) > 2500 else 'q'
                body.append(f'<div class="{cls}"><div class="q-head"><span class="q-no">{no}</span>'
                            f'<span class="q-title">{inline(qt)}</span>{badge}</div>{content}</div>')
            else:
                body.append(f'<h2 class="plain">{inline(t)}</h2>')
                body.append(render_blocks(lines))
        else:
            if t == '목차':
                body.append('<h3>목차</h3><ul class="toc">' + ''.join(toc) + '</ul>')
            elif t == '저희가 이해한 원광대 교육과정 운영 방식':
                tbl = [l for l in lines if l.strip().startswith('|')]
                head, row = split_row(tbl[0]), split_row(tbl[2])
                rest = [l for l in lines if not l.strip().startswith('|')]
                body.append(f'<h3>{inline(t)}</h3><div class="principle">'
                            f'<div class="other"><div class="t">{inline(head[0])}</div>{inline(row[0])}</div>'
                            f'<div class="wku"><div class="t">{inline(head[1])}</div>{inline(row[1])}</div></div>')
                body.append(render_blocks(rest))
            elif t in ('문의드리는 이유', '마치며'):
                body.append(f'<div class="box"><h3>{inline(t)}</h3>{render_blocks(lines)}</div>')
            elif t.startswith('2-2.'):
                text = ' '.join(l.strip() for l in lines if l.strip())
                items = [x.strip() for x in re.split(r'\),\s*', text) if x.strip()]
                lis = []
                for it in items:
                    name, _, when = it.rstrip(')').partition('(')
                    lis.append(f'<li>{inline(name.strip())} <span class="muted">({inline(when)})</span></li>')
                body.append(f'<h3>{inline(t)}</h3><ol class="deptlist">{"".join(lis)}</ol>')
            else:
                body.append(f'<h3>{inline(t)}</h3>')
                body.append(render_blocks(lines))

    if in_appendix:
        body.append('</div>')
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            f'<title>졸업요건 안내 서비스 — 교육과정·졸업요건 문의</title><style>{CSS}</style></head>'
            f'<body>\n' + '\n'.join(body) + '\n</body></html>\n')


def to_pdf(html_path, pdf_path):
    chrome = next((c for c in CHROME_CANDIDATES if os.path.exists(c)), None)
    if not chrome:
        sys.exit('Chrome/Edge를 찾지 못했습니다.')
    url = 'file:///' + os.path.abspath(html_path).replace('\\', '/')
    subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                    f'--print-to-pdf={os.path.abspath(pdf_path)}', url],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', action='store_true', help='PDF도 만든다')
    ap.add_argument('--contact', help='보내는 사람 연락처(보낼 PDF에만). 저장소 안에 출력하지 않는다')
    ap.add_argument('--out-dir', default=os.path.dirname(SRC))
    ap.add_argument('--src', default=SRC, help='원문 md (기본: 학교문의_발송용.md)')
    ap.add_argument('--name', default=NAME, help='출력 파일 이름(확장자 제외)')
    a = ap.parse_args()
    out_dir = os.path.abspath(a.out_dir)
    if a.contact and os.path.commonpath([out_dir, ROOT]) == ROOT:
        sys.exit('--contact를 쓸 때는 --out-dir를 저장소 밖으로 주세요(공개 저장소에 개인정보가 들어가지 않게).')
    with open(a.src, encoding='utf-8') as f:
        md = f.read()
    os.makedirs(out_dir, exist_ok=True)
    html_path = os.path.join(out_dir, a.name + '.html')
    with open(html_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(render(md, a.contact))
    print('HTML', html_path)
    if a.pdf:
        pdf_path = os.path.join(out_dir, a.name + '.pdf')
        to_pdf(html_path, pdf_path)
        print('PDF ', pdf_path)


if __name__ == '__main__':
    main()
