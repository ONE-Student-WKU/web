"""
scripts/import/parseTimetablePdfs.py
학과별 시간표 PDF(웹정보서비스 "학과/부/계열별 시간표 조회" 화면을 사람이 조회해 "화면 출력"으로 저장한 것) → 행 목록 JSON.

사용법:  python -I scripts/import/parseTimetablePdfs.py <PDF 폴더> <출력.json>
다음 단계: node scripts/import/buildTimetableSource.js <출력.json>  (앱 학과·트랙 연결 → db/curriculum/_source/ 원본)

왜 두 도구를 섞나: 학교 화면을 인쇄한 PDF는 한글이 Type3 폰트로 들어 있어 pdfplumber는 글자를 깨뜨리지만 표 칸 위치는 잘 찾고,
pypdf는 폰트의 ToUnicode를 제대로 읽어 글자가 정확하다. 그래서 칸 위치는 pdfplumber, 글자는 pypdf로 읽어 위치로 칸에 넣는다.
칸 안에서 줄이 바뀐 과목명(예: "정전개론(정전 / 1)")도 이렇게 하면 한 칸으로 이어진다.
pdfplumber·pypdf는 사용자 site-packages에 있다고 가정한다(-I로 실행해도 찾도록 경로를 직접 더한다).
"""
import sys, site, os, re, json, glob, logging
sys.path.append(site.getusersitepackages())
logging.disable(logging.WARNING)
import pdfplumber, pypdf

COLS = ['grade', 'category', 'code', 'name', 'section', 'credits', 'time', 'professor', 'room']


def fragments(page):
    """pypdf로 글자 조각과 위치(PDF 좌표, 왼쪽 아래 원점)를 모은다."""
    out = []

    def visit(text, cm, tm, font, size):
        if text and text.strip():
            out.append((text, tm[4] * cm[0] + tm[5] * cm[2] + cm[4], tm[4] * cm[1] + tm[5] * cm[3] + cm[5]))

    page.extract_text(visitor_text=visit)
    return out


def parse(path):
    reader = pypdf.PdfReader(path)
    rows, header = [], None
    with pdfplumber.open(path) as pl:
        for pi, (pp, rp) in enumerate(zip(pl.pages, reader.pages)):
            height = float(rp.mediabox.height)
            # 화면의 선택 칸 안내 문구(":::전공선택:::")가 표 위에 겹쳐 찍히는 경우가 있어 뺀다.
            frags = [(t, x, height - y) for t, x, y in fragments(rp) if not re.fullmatch(r'\s*:::.*:::\s*', t)]
            if pi == 0:
                # 머리글: "2026년 2학기  교학대학   원불교학과" — 학과 칸 폭 때문에 긴 이름은 잘려 찍힌다.
                m = re.search(r'(\d{4})년 (\d)학기\s+(.*?)\s{2,}(.*?)\n', rp.extract_text() or '')
                header = {'year': int(m.group(1)), 'term': int(m.group(2)), 'college': m.group(3).strip(), 'dept': m.group(4).strip()} if m else None
            for tb in pp.find_tables():
                full = [r for r in tb.rows if len(r.cells) == 9 and all(c is not None for c in r.cells)]
                if not full:
                    continue
                # 열 경계는 칸이 다 있는 행들에서 한 번 구해, 칸 경계를 못 찾은 행(페이지 끝에 걸친 행 등)에도 쓴다.
                bounds = [(min(r.cells[i][0] for r in full), max(r.cells[i][2] for r in full)) for i in range(9)]
                for r in tb.rows:
                    _, top, _, bottom = r.bbox
                    vals = []
                    for x0, x1 in bounds:
                        inside = sorted((f for f in frags if x0 - 1 <= f[1] <= x1 + 1 and top - 1 <= f[2] - 2 <= bottom + 1), key=lambda f: (round(f[2]), f[1]))
                        vals.append(re.sub(r'\s+', ' ', ''.join(f[0] for f in inside)).strip())
                    rec = dict(zip(COLS, vals))
                    if rec['grade'].startswith('학') or (not rec['code'] and not rec['name']):
                        continue  # 머리행·빈 행
                    rows.append(rec)
    return header, rows


if __name__ == '__main__':
    folder, out_path = sys.argv[1], sys.argv[2]
    result = []
    for f in sorted(glob.glob(os.path.join(folder, '*.pdf'))):
        try:
            h, rows = parse(f)
            result.append({'file': os.path.basename(f), 'header': h, 'rows': rows})
        except Exception as e:  # 읽지 못한 파일도 목록에 남겨 빠뜨리지 않게 한다
            result.append({'file': os.path.basename(f), 'error': repr(e)})
    with open(out_path, 'w', encoding='utf-8') as fp:
        json.dump(result, fp, ensure_ascii=False, indent=1)
    print(f'{len(result)}개 PDF → {out_path} (오류 {sum(1 for r in result if "error" in r)}개)')
