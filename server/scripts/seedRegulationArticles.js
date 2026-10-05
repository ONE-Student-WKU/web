const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../db');
const { buildRegulationSeed } = require('../services/regulationEngine/regulationSeed');

/**
 * server/scripts/seedRegulationArticles.js
 * 규정 원문(db/regulations/_source/*.txt) + 적용범위 원천(db/regulation-engine/applicability.json)을
 * regulation_versions / regulation_articles / regulation_relations / regulation_applicability에 시딩한다. 근거: db/schema.sql 7.5절.
 *
 * 이 네 테이블은 이 스크립트가 유일한 원천이라 통째로 지우고 다시 넣는다(멱등 — 몇 번 실행해도 같은 결과).
 * course_equivalences / course_category_overrides는 건드리지 않는다(학교 문서로 확인한 지정만 사람이 넣는 테이블).
 * 행 계산은 regulationSeed.js(순수 함수, 테스트 대상)가 하고 여기는 INSERT만 한다.
 *
 * 경고(인용문이 원문에 없음 등)가 하나라도 있으면 아무것도 쓰지 않고 실패한다 — 잘못된 근거가 DB에 들어가는 것보다 낫다.
 * 운영 DB에는 재시딩 워크플로에 이 스크립트가 아직 없다(DECISIONS D-24, HANDOFF 파트 3).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadInput() {
  const manual = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'db', 'regulation-engine', 'applicability.json'), 'utf8'));
  const texts = {};
  for (const d of manual.documents) texts[d.docCode] = fs.readFileSync(path.join(REPO_ROOT, d.file), 'utf8');
  return { manual, texts };
}

async function main() {
  const seed = buildRegulationSeed(loadInput());
  if (seed.warnings.length > 0) {
    for (const w of seed.warnings) console.error(`[WARN] ${w}`);
    throw new Error(`경고 ${seed.warnings.length}건 — 시딩 중단(DB 변경 없음)`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // FK 순서: 참조하는 쪽부터 지운다.
    await conn.query('DELETE FROM regulation_applicability');
    await conn.query('DELETE FROM regulation_relations');
    await conn.query('DELETE FROM regulation_articles');
    await conn.query('UPDATE regulation_versions SET supersedes_version_id = NULL');
    await conn.query('DELETE FROM regulation_versions');

    const versionId = new Map(); // `${docCode}|${label}` → id
    for (const v of seed.versions) {
      const [r] = await conn.query(
        `INSERT INTO regulation_versions
          (doc_code, title, version_label, promulgated_on, effective_from, effective_to, text_held, source_file, date_confidence, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.docCode, v.title, v.versionLabel, v.promulgatedOn, v.effectiveFrom, v.effectiveTo, v.textHeld ? 1 : 0,
          v.textHeld ? v.sourceFile || null : null, v.dateConfidence, v.note ? String(v.note).slice(0, 255) : null]
      );
      versionId.set(`${v.docCode}|${v.versionLabel}`, r.insertId);
    }
    for (const v of seed.versions) {
      if (!v.supersedesLabel) continue;
      await conn.query('UPDATE regulation_versions SET supersedes_version_id = ? WHERE id = ?',
        [versionId.get(`${v.docCode}|${v.supersedesLabel}`), versionId.get(`${v.docCode}|${v.versionLabel}`)]);
    }

    const articleId = new Map(); // `${docCode}:${articleKey}` → id
    for (const a of seed.articles) {
      const [r] = await conn.query(
        `INSERT INTO regulation_articles
          (version_id, article_key, article_no, section, title, chapter, body, amendment_markers, last_amended_on, ord)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [versionId.get(`${a.docCode}|${a.versionLabel}`), a.articleKey, a.articleNo, a.section,
          a.title ? a.title.slice(0, 200) : null, a.chapter, a.body,
          a.amendmentMarkers.length ? JSON.stringify(a.amendmentMarkers) : null, a.lastAmendedOn, a.ord]
      );
      articleId.set(`${a.docCode}:${a.articleKey}`, r.insertId);
    }

    for (const rel of seed.relations) {
      await conn.query(
        `INSERT INTO regulation_relations (from_article_id, relation, to_article_id, to_ref, source, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [articleId.get(rel.from), rel.relation, rel.to ? articleId.get(rel.to) : null,
          rel.toRef ? String(rel.toRef).slice(0, 160) : null, rel.source, rel.note]
      );
    }

    for (const ap of seed.applicability) {
      await conn.query(
        `INSERT INTO regulation_applicability
          (rule_code, article_id, article_ref, paragraph, scope, applies_from, min_admission_year, max_admission_year,
           enrollment_type, condition_code, condition_params, effect, confidence, critical, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ap.ruleCode, articleId.get(ap.articleRef) || null, ap.articleRef, ap.paragraph, ap.scope, ap.appliesFrom,
          ap.minAdmissionYear, ap.maxAdmissionYear, ap.enrollmentType, ap.conditionCode,
          ap.conditionParams ? JSON.stringify(ap.conditionParams) : null, ap.effect, ap.confidence, ap.critical ? 1 : 0, ap.note]
      );
    }

    await conn.commit();
    console.log(`regulation_versions ${seed.versions.length} / regulation_articles ${seed.articles.length} / ` +
      `regulation_relations ${seed.relations.length} / regulation_applicability ${seed.applicability.length}건 시딩`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

main()
  .catch((err) => {
    console.error('seedRegulationArticles 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
