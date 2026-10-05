/**
 * server/services/regulationEngine/relationWalk.js
 * 조문 관계(regulation_relations: 위임·참조·특칙·개정)를 따라가며 "이 조문이 왜 근거인가"의 경로를 만든다. 순수 함수(DB 없음).
 *
 * 왜 필요한가(보정 라운드 B, DECISIONS D-43): 규정 문서는 서로를 가리키며 이어진다 — 시행규칙 제118조는 졸업학점을 학칙 [별표 4]에 위임하고,
 * 제5조(일반 원칙)는 개편 시 제13조(경과조치)로 넘기며, 제13조가 제5조보다 우선한다. 이 연결은 DB에 저장돼 있었지만(178행) 판단이 한 번도
 * 읽지 않았다. 그래서 답은 "조문 하나"만 보고 만들어졌고, 위임받은 표나 우선하는 특칙, 이 조문을 개정한 부칙은 근거에서 빠졌다.
 * 이제 적용되는 조문에서 출발해 관계를 따라간 경로를 결과에 남긴다 — 사용자가 "왜 이 조문들이 근거인가"를 볼 수 있다.
 *
 * 따라가는 규칙(조문 ref = 'DOC:조문키'):
 *  - 위임(DELEGATES_TO): 깊이 2까지. 가장 강한 연결(위임받은 쪽이 실제 기준을 정한다).
 *  - 참조(REFERS): 깊이 1까지, 조문당 최대 REFERS_FANOUT개. 104개로 가장 많고 잡음이 커서(예: 제118조 → 제6조·제12조·학칙 제25조) 얕게만 따라간다.
 *  - 특칙(OVERRIDES): 양방향 — 이 조문이 덮는 일반 조문, 이 조문을 덮는 특칙을 모두 기록(깊이와 무관, 이동 없음).
 *  - 개정(AMENDS): 이 조문을 개정한 부칙(들어오는 방향)을 변경 이력으로 기록(이동 없음).
 *  - 별표 상위(예: 별표4) → 학번 구간 표(별표4-3): 관계 테이블이 아니라 적용범위(regulation_applicability)가 학번에 맞는 하위 표를 정하므로,
 *    호출자가 넘긴 appliedRefs(현재 적용되는 조문 ref)에 있는 하위 표만 'SELECTS_BY_COHORT' 단계로 잇는다.
 *  - 순환은 방문 집합으로 막고, 한 출발점당 도달 조문은 MAX_REACHED개까지(넘으면 truncated).
 *  - 조문으로 못 이은 대상(to_ref 문자열: 보유하지 않은 종전 부칙 등)은 이동하지 않고 unresolved로 남긴다 — 끊긴 연결을 숨기지 않는다.
 */

const MAX_DELEGATE_DEPTH = 2;
const MAX_REFER_DEPTH = 1;
const REFERS_FANOUT = 3;
const MAX_REACHED = 8;
const RELATION_LABEL = { DELEGATES_TO: '위임', REFERS: '참조', OVERRIDES: '특칙', AMENDS: '개정', SELECTS_BY_COHORT: '학번 구간' };

const keyNumber = (ref) => {
  const m = /:제(\d+)조/.exec(ref);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

/** 관계 행(camelCase) → 조회용 색인. rows: { relation, fromRef, toRef(조문 ref|null), toText(조문으로 못 이은 대상 설명|null), source, note } */
function buildRelationIndex(rows) {
  const out = new Map();
  const incoming = new Map();
  const push = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
  for (const r of rows || []) {
    push(out, r.fromRef, r);
    if (r.toRef) push(incoming, r.toRef, r);
  }
  return { out, incoming };
}

/** '부칙(2026.04.10.)제2조' 같은 부칙 조문 ref → '2026-04-10'(공포일). 부칙이 아니면 null. */
function addendumDateOfRef(ref) {
  const m = /:부칙\((\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(ref || '');
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

const edgeOf = (r, depth) => ({ from: r.fromRef, relation: r.relation, to: r.toRef, toText: r.toRef ? null : r.toText, source: r.source, note: r.note || null, depth });

/**
 * 한 조문에서 출발해 관계를 따라간 결과.
 * @param {string} rootRef  'DOC:조문키'
 * @param {{out:Map,incoming:Map}} index buildRelationIndex 결과
 * @param {{ appliedRefs?: Set<string> }} [opts]  appliedRefs: 현재 적용되는 조문 ref(별표 하위 표 선택용)
 * @returns {{ root, reached: [{ref, depth, path: edge[]}], overrides: edge[], overriddenBy: edge[], amendments: edge[], unresolved: edge[], truncated: boolean }}
 */
function walkRelations(rootRef, index, { appliedRefs = new Set() } = {}) {
  const reached = [];
  const unresolved = [];
  const visited = new Set([rootRef]);
  let truncated = false;
  // BFS: queue 항목 = { ref, depth, path }
  const queue = [{ ref: rootRef, depth: 0, path: [] }];
  while (queue.length) {
    const cur = queue.shift();
    const outs = (index.out.get(cur.ref) || []).filter((r) => r.relation === 'DELEGATES_TO' || r.relation === 'REFERS');
    const delegates = outs.filter((r) => r.relation === 'DELEGATES_TO');
    const refers = outs.filter((r) => r.relation === 'REFERS' && r.toRef).sort((a, b) => keyNumber(a.toRef) - keyNumber(b.toRef)).slice(0, REFERS_FANOUT);
    const steps = [];
    if (cur.depth < MAX_DELEGATE_DEPTH) steps.push(...delegates);
    if (cur.depth < MAX_REFER_DEPTH) steps.push(...refers);
    // 조문으로 못 이은 대상은 이동하지 않고 끊긴 연결로 기록(위임·참조 모두)
    for (const r of outs) {
      if (!r.toRef && !unresolved.some((u) => u.from === r.fromRef && u.toText === r.toText)) unresolved.push(edgeOf(r, cur.depth + 1));
    }
    for (const r of steps) {
      if (!r.toRef) continue;
      const nexts = [{ ref: r.toRef, edge: edgeOf(r, cur.depth + 1) }];
      // 별표 상위(별표N) → 적용 중인 하위 표(별표N-k)
      if (/:별표\d+$/.test(r.toRef)) {
        for (const child of appliedRefs) {
          if (child.startsWith(`${r.toRef}-`)) nexts.push({ ref: child, edge: { from: r.toRef, relation: 'SELECTS_BY_COHORT', to: child, toText: null, source: 'APPLICABILITY', note: '학번 구간에 맞는 표(regulation_applicability)', depth: cur.depth + 2 } });
        }
      }
      let parent = cur.path;
      for (const n of nexts) {
        if (visited.has(n.ref)) continue;
        if (reached.length >= MAX_REACHED) { truncated = true; break; }
        visited.add(n.ref);
        const path = [...parent, n.edge];
        reached.push({ ref: n.ref, depth: path.length, path });
        queue.push({ ref: n.ref, depth: cur.depth + 1, path }); // depth = 관계를 따라 이동한 횟수(하위 표 선택은 이동이 아님)
        parent = path; // 하위 표는 상위 표 다음 단계
      }
    }
  }
  const outsOf = (ref, rel) => (index.out.get(ref) || []).filter((r) => r.relation === rel && r.toRef);
  const insOf = (ref, rel) => (index.incoming.get(ref) || []).filter((r) => r.relation === rel);
  return {
    root: rootRef,
    reached,
    overrides: outsOf(rootRef, 'OVERRIDES').map((r) => edgeOf(r, 1)),
    overriddenBy: insOf(rootRef, 'OVERRIDES').map((r) => edgeOf(r, 1)),
    amendments: insOf(rootRef, 'AMENDS').map((r) => ({ ...edgeOf(r, 1), date: addendumDateOfRef(r.fromRef) })),
    unresolved,
    truncated,
  };
}

/** 'DOC:키' → 사람이 읽는 이름. 별표 하위표는 ①~④ 번호, 부칙은 그대로. */
const DOC_NAME = { ENFORCEMENT_RULES: '학칙시행규칙', ACADEMIC_REGULATIONS: '학칙', CLASS_MANAGEMENT: '수업관리규정' };
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥'];
function refLabel(ref) {
  const [doc, key] = String(ref).split(':');
  const m = /^별표(\d+)-(\d+)$/.exec(key);
  const name = DOC_NAME[doc] || doc;
  if (m) return `${name} [별표 ${m[1]}] ${CIRCLED[Number(m[2])] || m[2]}`;
  const b = /^별표(\d+)$/.exec(key);
  if (b) return `${name} [별표 ${b[1]}]`;
  return `${name} ${key}`;
}

/** 경로(edge 배열) → '위임 → 학칙 [별표 4] → 학번 구간 → 학칙 [별표 4] ③' 같은 한 줄. 출발 조문은 앞에 붙이지 않는다. */
function pathText(path) {
  return path.map((e) => `${RELATION_LABEL[e.relation] || e.relation} ${refLabel(e.to)}`).join(' → ');
}

/**
 * 여러 규칙의 evidence(walkRelations 결과)를 한 번에 요약한다 — 챗봇 근거·진단 화면이 같은 모양을 쓰도록.
 * 같은 조문에 규칙이 여럿(제13조 ①~④)이어도 조문 기준으로 한 번만 센다.
 * @param {Array<{ status: string, basis: {articleRef: string}, evidence: object|null }>} rules resolveApplicableRules의 rules
 * @returns {{ paths: [{root, rootLabel, critical, steps: [{ref, label, text, relation, depth}]}] (critical 먼저), overrides: [{special, general, critical}], amendments: [{ref, label, date, target, targetLabel, critical}], broken: [{root, rootLabel, relation, toText}] }}
 */
function summarizeEvidence(rules) {
  const seenRoot = new Set();
  const paths = [];
  const overrides = new Map();
  const amendments = new Map();
  const broken = new Map();
  for (const r of rules || []) {
    if (r.status === 'NOT_APPLICABLE' || !r.evidence) continue;
    const root = r.evidence.root;
    if (seenRoot.has(root)) continue;
    seenRoot.add(root);
    const rootLabel = refLabel(root);
    const critical = r.critical !== false;
    if (r.evidence.reached.length) {
      paths.push({ root, rootLabel, critical, steps: r.evidence.reached.map((n) => ({ ref: n.ref, label: refLabel(n.ref), text: pathText(n.path), relation: n.path[n.path.length - 1].relation, depth: n.depth })) });
    }
    for (const e of r.evidence.overrides) overrides.set(`${root}>${e.to}`, { special: root, general: e.to, critical });
    for (const e of r.evidence.overriddenBy) overrides.set(`${e.from}>${root}`, { special: e.from, general: root, critical });
    for (const e of r.evidence.amendments) amendments.set(`${e.from}>${root}`, { ref: e.from, label: refLabel(e.from), date: e.date, target: root, targetLabel: rootLabel, critical });
    for (const e of r.evidence.unresolved) broken.set(`${root}|${e.toText}`, { root, rootLabel, relation: e.relation, toText: /^[A-Z_]+:/.test(e.toText) ? refLabel(e.toText) : e.toText });
  }
  // 참고 규정(critical=false, 예: 수업관리규정)의 경로는 뒤로 — 챗봇 줄·관련 조문 상한이 핵심 규정의 경로를 밀어내지 않게 한다.
  paths.sort((a, b) => Number(b.critical) - Number(a.critical));
  return {
    paths,
    overrides: [...overrides.values()],
    amendments: [...amendments.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    broken: [...broken.values()],
  };
}

const RELATED_PRIORITY = { OVERRIDES: 0, DELEGATES_TO: 1, REFERS: 2 };

/**
 * 챗봇 근거로 원문까지 붙일 "관련 조문" 후보 — 적용 조문 자체와 별표(표 원문은 길고 깨져 제목만 인용)는 뺀다. 참고 규정(critical=false)에서 출발한 경로는 쓰지 않는다.
 * 우선순위: 특칙 상대(덮는/덮이는 조문) > 위임 > 참조. 같은 조문은 가장 높은 우선순위 하나로 합친다.
 * @returns {Array<{ref, label, how, priority}>} 우선순위 순
 */
function relatedArticleCandidates(summary, appliedRefs, limit) {
  const applied = new Set(appliedRefs);
  const best = new Map();
  const consider = (ref, relation, how) => {
    if (applied.has(ref) || /:별표/.test(ref)) return;
    const priority = RELATED_PRIORITY[relation];
    const cur = best.get(ref);
    if (!cur || priority < cur.priority) best.set(ref, { ref, label: refLabel(ref), how, priority });
  };
  for (const o of summary.overrides) {
    if (!o.critical) continue;
    if (applied.has(o.special) && !applied.has(o.general)) consider(o.general, 'OVERRIDES', `${refLabel(o.special)}이(가) 우선하는 일반 조문`);
    if (applied.has(o.general) && !applied.has(o.special)) consider(o.special, 'OVERRIDES', `${refLabel(o.general)}보다 우선하는 특칙`);
  }
  for (const p of summary.paths) {
    if (!p.critical) continue;
    for (const s of p.steps) consider(s.ref, s.relation, `${p.rootLabel}에서 ${s.text}`);
  }
  return [...best.values()].sort((a, b) => a.priority - b.priority || a.ref.localeCompare(b.ref)).slice(0, limit);
}

module.exports = { buildRelationIndex, walkRelations, summarizeEvidence, relatedArticleCandidates, addendumDateOfRef, refLabel, pathText, RELATION_LABEL, DOC_NAME, MAX_REACHED, REFERS_FANOUT, MAX_DELEGATE_DEPTH, MAX_REFER_DEPTH };
