#!/usr/bin/env node
/**
 * scripts/dev/inquiryDraftSamples.js  (node scripts/dev/inquiryDraftSamples.js)
 * 문의 답변 AI 초안의 말투를 잡으려고, 지어낸 문의(종류별 하나씩)로 초안을 뽑아 docs/inquiry-draft-samples.md에 정리한다.
 * 운영자가 "교정본" 칸을 고치면, 그 교정본을 server/services/inquiryDraftService.js의 예시(few-shot)로 넣는다.
 *
 * - 문의는 모두 지어낸 것이라 실제 학생 정보는 AI에 가지 않는다. 실제 AI(Anthropic)와 규정 검색(Voyage, 로컬 DB)을 부르므로
 *   로컬 .env의 키가 필요하고 비용이 조금 든다(초안 7개).
 * - 이미 교정본이 적힌 문서를 덮어쓰지 않도록, 문서가 있으면 docs/inquiry-draft-samples.new.md로 쓴다.
 */

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
require(require.resolve('dotenv', { paths: [path.join(ROOT, 'server'), ROOT] })).config({ path: path.join(ROOT, '.env') });

const inquiryDraftService = require(path.join(ROOT, 'server', 'services', 'inquiryDraftService'));
const pool = require(path.join(ROOT, 'server', 'db'));

const SAMPLES = [
  {
    kind: '오류 제보',
    title: '성적표 PDF가 안 올라가요',
    content: '과목 관리에서 웹정보서비스 전체성적조회를 PDF로 저장해서 올렸는데 "읽을 수 없는 파일"이라고 떠요. 두 번 해 봤는데 똑같아요.',
    departmentName: '경영학부',
    admissionYear: 2023,
  },
  {
    kind: '사용법',
    title: '커뮤니티 글이 목록에 안 보여요',
    content: '어제 스터디 모집 글을 올렸는데 전체 글 목록에 안 나와요. 삭제된 건가요?',
    departmentName: '컴퓨터·소프트웨어공학과',
    admissionYear: 2024,
  },
  {
    kind: '졸업요건·학사',
    title: '졸업학점이 몇 학점인가요',
    content: '2022학번인데 졸업요건 진단에는 130학점으로 나오고 친구는 136이라고 해서 헷갈려요. 어느 게 맞나요?',
    departmentName: '컴퓨터·소프트웨어공학과',
    admissionYear: 2022,
  },
  {
    kind: '계정',
    title: '로그인 이메일을 바꾸고 싶어요',
    content: '처음에 개인 메일로 가입했는데 학교 메일로 바꾸고 싶어요. 바꿀 수 있나요?',
    departmentName: '간호학과',
    admissionYear: 2025,
  },
  {
    kind: '개선 제안',
    title: '시간표 기능도 있으면 좋겠어요',
    content: '졸업요건 진단에서 부족한 과목을 보고 바로 다음 학기 시간표를 짜 볼 수 있으면 좋겠어요.',
    departmentName: '경영학부',
    admissionYear: 2024,
  },
  {
    kind: '욕설·비방',
    title: '답변 왜 안 해요',
    content: '졸업요건이 계속 틀리게 나오는데 일을 이따위로 하냐 빨리 고쳐요',
    departmentName: '컴퓨터·소프트웨어공학과',
    admissionYear: 2022,
    action: '경고',
  },
  {
    kind: '그 밖',
    title: '학교에서 만든 서비스인가요?',
    content: '이 서비스 학교에서 공식으로 만든 건가요? 여기 진단 결과를 학과 사무실에 보여 줘도 되나요?',
    departmentName: '국어국문학과',
    admissionYear: 2023,
  },
];

function block(text) {
  return ['```text', text, '```'].join('\n');
}

async function main() {
  if (!process.env.AI_API_KEY) throw new Error('.env에 AI_API_KEY가 없어요.');
  const sections = [];
  for (const [i, s] of SAMPLES.entries()) {
    const result = await inquiryDraftService.composeDraft(s);
    const typeLabel = result ? inquiryDraftService.DRAFT_TEMPLATES[result.type]?.label || result.type : '(초안 없음)';
    console.log(`${i + 1}/${SAMPLES.length} ${s.kind} → AI가 고른 종류: ${typeLabel}`);
    sections.push(
      [
        `## ${i + 1}. ${s.kind}`,
        '',
        `**문의** — ${s.departmentName} · ${s.admissionYear}학번${s.action ? ` · 제안 조치: ${s.action}` : ''}`,
        '',
        `> **${s.title}**  `,
        `> ${s.content}`,
        '',
        `**AI 초안** (AI가 고른 종류: ${typeLabel})`,
        '',
        block(result ? result.draft : '(초안을 만들지 못함)'),
        '',
        '**교정본** — 아래 칸을 원하는 답변으로 고쳐 주세요. 그대로 좋으면 AI 초안을 그대로 두면 됩니다.',
        '',
        block(result ? result.draft : ''),
        '',
      ].join('\n')
    );
  }

  const header = [
    '# 문의 답변 AI 초안 — 예시와 교정본',
    '',
    `뽑은 날: ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })} · 만든 스크립트: \`scripts/dev/inquiryDraftSamples.js\``,
    '',
    '문의 답변 AI 초안(`server/services/inquiryDraftService.js`)의 말투를 잡기 위한 문서입니다. 문의는 모두 지어낸 것입니다.',
    '각 항목의 **교정본** 칸을 실제로 보내고 싶은 답변으로 고치면, 그 교정본을 초안 프롬프트의 예시로 넣어 말투를 맞춥니다.',
    '인사("안녕하세요, ONE Student 운영팀입니다."), 맺음말("감사합니다."), 욕설 문의의 조치 문장은 코드가 붙이는 고정 문장입니다.',
    '이 문장들도 바꾸고 싶으면 교정본에서 고쳐 주세요(모든 초안에 같이 바뀝니다).',
    '',
  ].join('\n');

  const target = path.join(ROOT, 'docs', 'inquiry-draft-samples.md');
  const out = fs.existsSync(target) ? path.join(ROOT, 'docs', 'inquiry-draft-samples.new.md') : target;
  fs.writeFileSync(out, `${header}\n${sections.join('\n')}`);
  console.log(`썼어요: ${path.relative(ROOT, out)}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
