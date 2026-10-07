const { parseRegulationText, extractRelations } = require('./articleParser');

/**
 * server/services/regulationEngine/regulationSeed.js
 * 원문 txt + db/regulation-engine/applicability.json → regulation_versions/articles/relations/applicability에 넣을 행. 순수 함수.
 * DB 쓰기는 server/scripts/seedRegulationArticles.js가 한다(이 파일을 테스트에서 DB 없이 검증하기 위해 분리).
 *
 * 판본(version) 만드는 규칙 — 확인된 것만 쓴다:
 *  - 원문 끝의 부칙 하나 = 판본 하나(부칙 날짜 = 공포일, 부칙 문장의 시행일 = 시행일).
 *  - 표지의 '제정' 줄이 부칙 목록에 없으면(학칙·시행규칙: 부칙이 2026 전부개정부터만 있음) 제정 판본을 따로 두되 시행일은 UNKNOWN.
 *  - 대체관계(supersedes)는 "같은 원문의 부칙 목록 안에서 바로 앞 부칙"일 때만 잇는다. 목록 밖(전부개정 이전)과는 잇지 않는다 —
 *    중간 개정이 몇 번 있었는지 모르기 때문.
 *  - 본문 보유(text_held)는 마지막 판본(현행)만 1.
 */

const normalize = (s) => String(s).normalize('NFKC').replace(/\s+/g, '');

function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function buildVersions(doc, parsed, knownVersions) {
  const versions = [];
  const enactment = parsed.header.find((h) => h.kind === '제정');
  const firstAddendum = parsed.addenda[0];
  const enactmentInAddenda = firstAddendum && firstAddendum.label == null; // 수업관리규정: 첫 부칙이 라벨 없는 제정 부칙
  if (enactment && !enactmentInAddenda) {
    versions.push({
      docCode: doc.docCode, title: doc.title, versionLabel: '제정', promulgatedOn: enactment.date, effectiveFrom: null,
      dateConfidence: 'UNKNOWN', inAddendaChain: false, note: '표지의 제정일. 제정 당시 본문·시행일 미보유',
    });
  }
  for (const k of knownVersions.filter((v) => v.docCode === doc.docCode)) {
    versions.push({ ...k, title: doc.title, inAddendaChain: false });
  }
  const chainStart = versions.length;
  for (const a of parsed.addenda) {
    const isEnactment = a.label == null;
    const label = isEnactment ? '제정' : a.label;
    const promulgatedOn = a.promulgatedOn || (isEnactment && enactment ? enactment.date : null);
    const header = parsed.header.find((h) => h.date === promulgatedOn);
    versions.push({
      docCode: doc.docCode, title: doc.title, versionLabel: label, promulgatedOn,
      effectiveFrom: a.effective.date, dateConfidence: a.effective.confidence, inAddendaChain: true, sourceFile: doc.file,
      note: [header && header.kind !== '개정' ? header.kind : null, a.effective.basis ? `시행일 근거: ${a.effective.basis}` : '시행일 문구 없음'].filter(Boolean).join(' / '),
    });
  }
  for (let i = chainStart; i < versions.length; i++) {
    const v = versions[i];
    const next = versions[i + 1];
    v.supersedesLabel = i > chainStart ? versions[i - 1].versionLabel : null;
    v.effectiveTo = next && next.effectiveFrom && v.effectiveFrom ? dayBefore(next.effectiveFrom) : null;
    v.textHeld = i === versions.length - 1;
  }
  for (const v of versions.slice(0, chainStart)) {
    v.supersedesLabel = null;
    v.effectiveTo = null;
    v.textHeld = false;
  }
  return versions;
}

function articleIndex(articlesByDoc) {
  const map = new Map();
  for (const [docCode, list] of Object.entries(articlesByDoc)) for (const a of list) map.set(`${docCode}:${a.articleKey}`, a);
  return map;
}

/**
 * @param {{ texts: Record<string,string>, manual: object }} input  texts: docCode → 원문, manual: applicability.json 내용
 * @returns {{ versions, articles, relations, applicability, warnings }}
 */
function buildRegulationSeed({ texts, manual }) {
  const warnings = [];
  const versions = [];
  const articles = [];
  const articlesByDoc = {};

  for (const doc of manual.documents) {
    const text = texts[doc.docCode];
    if (text == null) {
      warnings.push(`${doc.docCode}: 원문 없음 — 건너뜀`);
      continue;
    }
    const parsed = parseRegulationText(text);
    const docVersions = buildVersions(doc, parsed, manual.knownVersions || []);
    versions.push(...docVersions);
    const held = docVersions.find((v) => v.textHeld);
    articlesByDoc[doc.docCode] = parsed.articles;
    for (const a of parsed.articles) articles.push({ ...a, docCode: doc.docCode, versionLabel: held.versionLabel });
  }

  const index = articleIndex(articlesByDoc);
  const resolveRef = (ref) => index.get(ref) || null;

  const relations = [];
  for (const [docCode, list] of Object.entries(articlesByDoc)) {
    for (const a of list) {
      if (a.section === 'SCHEDULE') continue; // 별표 본문은 표라서 조문 참조 패턴이 거의 없고 오탐만 생긴다
      for (const r of extractRelations(a.body, docCode, a.articleKey)) {
        const toRef = r.toDoc ? `${r.toDoc}:${r.toKey}` : null;
        const target = toRef ? resolveRef(toRef) : null;
        relations.push({
          from: `${docCode}:${a.articleKey}`, relation: r.relation,
          to: target ? toRef : null,
          toRef: target ? null : (r.toRef || toRef),
          source: 'PARSED', note: null,
        });
      }
    }
    // 개정 표시 → AMENDS: <개정 D> 표시가 있는 조문은 같은 문서의 D자 부칙이 바꾼 것.
    const addendumByDate = new Map();
    for (const a of list) {
      const m = a.section === 'ADDENDUM' && /^부칙\((\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(a.articleKey);
      if (!m) continue;
      const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      if (!addendumByDate.has(date)) addendumByDate.set(date, a); // 그 부칙의 첫 조문(보통 제1조 시행일)
    }
    for (const a of list) {
      const dates = new Set(a.amendmentMarkers.flatMap((m) => m.dates));
      for (const d of dates) {
        const add = addendumByDate.get(d);
        if (!add) continue;
        relations.push({ from: `${docCode}:${add.articleKey}`, relation: 'AMENDS', to: `${docCode}:${a.articleKey}`, toRef: null, source: 'PARSED', note: `<개정·신설 ${d}> 표시` });
      }
    }
  }

  for (const r of manual.relations || []) {
    const from = resolveRef(r.from);
    if (!from) {
      warnings.push(`관계 출발 조문을 찾지 못함: ${r.from}`);
      continue;
    }
    if (r.quote && !normalize(from.body).includes(normalize(r.quote))) warnings.push(`관계 인용문이 ${r.from} 본문에 없음: ${r.quote}`);
    const to = r.to ? resolveRef(r.to) : null;
    if (r.to && !to) warnings.push(`관계 대상 조문을 찾지 못함: ${r.to}`);
    relations.push({ from: r.from, relation: r.relation, to: to ? r.to : null, toRef: to ? null : (r.toRef || r.to), source: 'MANUAL', note: r.note || null });
  }

  const applicability = [];
  for (const rule of manual.rules) {
    const article = resolveRef(rule.articleRef);
    if (!article) warnings.push(`적용범위 조문을 찾지 못함: ${rule.ruleCode} → ${rule.articleRef}`);
    else if (!normalize(article.body).includes(normalize(rule.quote))) warnings.push(`적용범위 인용문이 ${rule.articleRef} 본문에 없음: ${rule.ruleCode}`);
    applicability.push({
      ruleCode: rule.ruleCode,
      articleRef: rule.articleRef,
      paragraph: rule.paragraph ?? null,
      scope: rule.scope,
      appliesFrom: rule.appliesFrom ?? null,
      minAdmissionYear: rule.minAdmissionYear ?? null,
      maxAdmissionYear: rule.maxAdmissionYear ?? null,
      enrollmentType: rule.enrollmentType ?? null,
      conditionCode: rule.conditionCode ?? null,
      conditionParams: rule.conditionParams ?? null,
      effect: rule.effect,
      confidence: rule.confidence,
      critical: rule.critical !== false,
      note: rule.note ?? null,
      quote: rule.quote,
    });
  }

  return { versions, articles, relations: dedupeRelations(relations), applicability, warnings };
}

function dedupeRelations(list) {
  const seen = new Set();
  return list.filter((r) => {
    const k = `${r.from}|${r.relation}|${r.to}|${r.toRef}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

module.exports = { buildRegulationSeed, buildVersions, normalize };
