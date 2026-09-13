const crypto = require('crypto');
const pool = require('../db');

/**
 * server/services/communityService.js
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — DB 접근 계층.
 * 신청/수락/모집마감 관련 함수는 3단계에서 추가된다.
 */

// EMAIL_PROXY_DOMAIN은 .env(로컬) / Railway 환경변수(운영)에서 주입 (#182 — 이메일 프록시,
// mailer.js의 RESEND_FROM_ADDRESS와 동일한 주입 방식). 인바운드 수신 서비스(2단계)가
// 이 도메인의 MX 레코드를 받도록 설정돼야 프록시 주소로 온 메일이 실제로 전달된다.
const EMAIL_PROXY_DOMAIN = process.env.EMAIL_PROXY_DOMAIN;

// 프록시 주소는 실제 이메일과 무관한 무작위 토큰이어야 한다 — 원래 주소의 일부라도
// 남으면(예: hong-xxxx@) 역추적 단서가 되거나 다른 사람이 패턴으로 프록시 주소를 추측할
// 여지가 생긴다.
function generateProxyEmail() {
  return `${crypto.randomBytes(8).toString('hex')}@${EMAIL_PROXY_DOMAIN}`;
}

// 신청이 수락되면(매칭 성사) 신청자·글쓴이 각자를 위한 프록시를 하나씩 만든다. owner_id는
// "이 프록시로 온 메일을 실제로 받을 사람"이라, 신청자에게 보여줄 프록시는 owner_id=authorId로,
// 글쓴이에게 보여줄 프록시는 owner_id=applicantId로 만든다(getMyApplications/
// getApplicantsForPost가 조회 시점에 각자 반대쪽 프록시를 찾아서 내려줌). UNIQUE 제약과
// 충돌하면(극히 낮은 확률) 재생성해서 재시도한다.
async function createEmailProxiesForApplication(applicationId, applicantId, authorId) {
  for (const ownerId of [applicantId, authorId]) {
    for (let attempt = 0; ; attempt++) {
      try {
        await pool.query(
          'INSERT INTO community_email_proxies (application_id, owner_id, proxy_email) VALUES (?, ?, ?)',
          [applicationId, ownerId, generateProxyEmail()]
        );
        break;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY' || attempt >= 2) throw err;
      }
    }
  }
}

// 인바운드로 온 메일의 수신 주소(프록시)로 "실제 수신자 이메일"과 "상대방 프록시 주소
// (발신자로 표시할 값)"를 찾는다(#182 2단계, server/routes/emailRelay.js가 호출). 한
// application당 프록시가 정확히 2개라 "나(매칭된 프록시) 아닌 쪽"이 곧 상대방이라는
// 사실만으로 찾을 수 있다 — 인바운드 메일의 실제 발신 주소(from)는 신뢰하지 않는다
// (신뢰할 필요도 없다).
async function findEmailRelayTarget(toProxyEmail) {
  const [rows] = await pool.query('SELECT application_id, owner_id FROM community_email_proxies WHERE proxy_email = ?', [
    toProxyEmail,
  ]);
  const matched = rows[0];
  if (!matched) return null;

  const [[recipient]] = await pool.query('SELECT email FROM students WHERE id = ?', [matched.owner_id]);
  if (!recipient) return null;

  const [siblingRows] = await pool.query(
    'SELECT proxy_email FROM community_email_proxies WHERE application_id = ? AND owner_id != ?',
    [matched.application_id, matched.owner_id]
  );
  const sibling = siblingRows[0];
  if (!sibling) return null;

  return { recipientEmail: recipient.email, senderProxyEmail: sibling.proxy_email };
}

// studentService.js의 serializeStudent()와 동일한 닉네임 폴백(student.name || user{id}) —
// 가입 시 name을 NULL로 남겨두는 정책이라 표시 시점에 계산해야 한다. 한 곳(studentService)의
// 규칙을 SQL로 다시 구현하지 않고 그대로 재사용. 닉네임을 어디에도 스냅샷 저장하지 않고
// 항상 이 함수로 실시간 조회하므로, 학생이 나중에 닉네임을 바꾸면 과거에 쓴 글/신청에도
// 자동으로 반영된다(별도 동기화 로직 불필요).
function nicknameOf(name, id) {
  return name || `user${id}`;
}

// 이 학과에 승인 대기 없이도 학생이 볼 수 있는 글 목록을 위한 전제: status='pending'인
// 글은 목록/상세 어디서도 제3자에게 노출되면 안 된다(db/schema.sql 커뮤니티 게시판 주석
// 참고 — 관리자 승인 전엔 비공개). 아래 학생용 함수들이 이 규칙을 지킨다.

async function createPost(authorId, { title, body, category, capacity }) {
  const [result] = await pool.query(
    "INSERT INTO community_posts (author_id, title, body, category, capacity, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    [authorId, title, body, category, capacity]
  );
  return result.insertId;
}

async function listApprovedPosts() {
  const [rows] = await pool.query(
    `SELECT p.id, p.title, p.body, p.category, p.capacity, p.closed_at, p.created_at, p.author_id, s.name AS author_name
     FROM community_posts p
     JOIN students s ON s.id = p.author_id
     WHERE p.status = 'approved'
     ORDER BY p.created_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    capacity: row.capacity,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    author: nicknameOf(row.author_name, row.author_id),
  }));
}

// 작성자 본인은 상태(대기/승인/반려) 무관하게 자기 글을 전부 볼 수 있다 — 승인 전엔
// 목록에 안 뜨니 이게 없으면 글을 썼는지 확인할 방법이 없다.
async function listMyPosts(studentId) {
  const [rows] = await pool.query(
    `SELECT id, title, body, category, capacity, status, closed_at, created_at
     FROM community_posts
     WHERE author_id = ?
     ORDER BY created_at DESC`,
    [studentId]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    capacity: row.capacity,
    status: row.status,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  }));
}

// 승인된 글은 누구나, 그 외(대기/반려)는 작성자 본인만 볼 수 있다 — id를 알아도 남의
// 비공개 글을 못 보게 막는 게 목적. 이 함수가 신청 가능 여부 판정도 겸한다(3단계 —
// server/routes/community.js의 POST /:id/apply가 그대로 재사용): null이면 신청 대상도
// 아님, isMine이면 자기 글이라 신청 불가, closedAt 있으면 마감이라 신청 불가.
async function getPostById(id, { studentId }) {
  const [rows] = await pool.query(
    `SELECT p.id, p.title, p.body, p.category, p.capacity, p.status, p.closed_at, p.created_at, p.author_id, p.reject_reason, s.name AS author_name
     FROM community_posts p
     JOIN students s ON s.id = p.author_id
     WHERE p.id = ?`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const isMine = row.author_id === studentId;
  let myApplication = null;
  if (!isMine) {
    const [appRows] = await pool.query(
      `SELECT id, status, reject_reason FROM community_applications
       WHERE post_id = ? AND applicant_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [id, studentId]
    );
    if (appRows[0]) {
      myApplication = {
        id: appRows[0].id,
        status: appRows[0].status,
        rejectReason: appRows[0].status === 'rejected' ? appRows[0].reject_reason : null,
      };
    }
  }

  // 미승인(수정 후 재검수 대기 포함) 글은 원래 작성자만 조회 가능하지만, 이미 수락된
  // 신청자는 예외로 조회 자체는 허용한다 — 다만 재검수 전 콘텐츠(제목·본문)는 계속 가리고
  // 신청 상태만 확인할 수 있게 한다(이슈 #196: "글 콘텐츠 열람"과 "내 신청 상태 확인" 분리).
  const isAcceptedApplicant = myApplication?.status === 'accepted';
  if (row.status !== 'approved' && !isMine && !isAcceptedApplicant) return null;

  const contentHidden = row.status !== 'approved' && !isMine;

  return {
    id: row.id,
    title: contentHidden ? null : row.title,
    body: contentHidden ? null : row.body,
    category: row.category,
    capacity: row.capacity,
    status: row.status,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    author: nicknameOf(row.author_name, row.author_id),
    isMine,
    myApplication,
    rejectReason: isMine ? row.reject_reason : null,
    contentHidden,
  };
}

// 글 수정 — 재승인 대상이라 status를 pending으로 되돌리고 decided_at을 비운다(다시
// 관리자 검토 큐에 들어가고, getPostById의 "미승인 글은 작성자만 조회 가능" 규칙이 그대로
// 적용돼 공개 목록에서 사라진다). closed_at은 건드리지 않는다(마감 여부는 수정과 무관한
// 별개 상태). 이미 달린 신청(대기/수락 포함)도 그대로 둔다 — 수정은 글 노출 여부만
// 잠그지, 신청 데이터를 건드리지 않는다.
async function editPost(id, authorId, { title, body, category, capacity }) {
  const [result] = await pool.query(
    `UPDATE community_posts SET title = ?, body = ?, category = ?, capacity = ?, status = 'pending', decided_at = NULL
     WHERE id = ? AND author_id = ?`,
    [title, body, category, capacity, id, authorId]
  );
  return result.affectedRows > 0;
}

// 삭제는 관리자 승인과 무관하게 작성자가 상태(대기/승인/반려/마감) 상관없이 언제든 할 수
// 있다 — db/schema.sql의 FK ON DELETE CASCADE가 딸린 신청(community_applications)도
// 같이 정리해준다. 관리자 전용 deletePost(아래, id만 받고 소유권 확인 없음)와는 별개 함수.
async function deletePostByAuthor(id, authorId) {
  const [result] = await pool.query('DELETE FROM community_posts WHERE id = ? AND author_id = ?', [id, authorId]);
  return result.affectedRows > 0;
}

// 마감 시점에 대기 중이던 신청은 자동 반려(이슈 명세) — 글쓴이가 마감한 순간 더 이상
// 검토 대상이 아니게 됐다는 뜻이라, 신청자 쪽에도 "대기중"으로 영원히 멈춰있지 않고
// 결과가 나가야 한다. status='approved' 글만 마감 가능 — 아직 관리자 승인을 못 받은
// (혹은 반려된) 글은 애초에 "모집 중"인 적이 없으므로 마감이라는 개념 자체가 성립하지 않는다.
// 신청이 1건도 없는 글은 마감 자체가 무의미해서(검토할 게 없으니) 마감을 막는다 —
// 프론트(Community.jsx)가 버튼을 비활성화해두지만, API를 직접 호출하는 우회도 막기 위해
// 여기서도 EXISTS로 다시 확인한다.
async function closePost(id, authorId) {
  const [result] = await pool.query(
    `UPDATE community_posts SET closed_at = NOW()
     WHERE id = ? AND author_id = ? AND status = 'approved' AND closed_at IS NULL
       AND EXISTS (SELECT 1 FROM community_applications WHERE post_id = community_posts.id)`,
    [id, authorId]
  );
  if (result.affectedRows === 0) return false;

  await pool.query(
    "UPDATE community_applications SET status = 'rejected', decided_at = NOW() WHERE post_id = ? AND status = 'pending'",
    [id]
  );
  return true;
}

// 한 글에 동시에 유효한(대기중/수락됨) 신청은 1인 1건만 허용 — 반려된 신청은 "유효"가
// 아니라서 걸리지 않으므로 반려 후 재신청은 자연히 허용된다(새 행으로 남아 이전 반려
// 이력도 그대로 보존됨). 글이 신청 가능한 상태인지(승인됨/마감 안 됨/본인 글 아님)는
// 호출부(routes/community.js)가 getPostById로 먼저 확인한다.
const MAX_APPLICATIONS_PER_POST = 3;

async function applyToPost(postId, applicantId, message) {
  const [existing] = await pool.query(
    "SELECT id FROM community_applications WHERE post_id = ? AND applicant_id = ? AND status IN ('pending', 'accepted') LIMIT 1",
    [postId, applicantId]
  );
  if (existing.length > 0) return { ok: false, reason: 'DUPLICATE_APPLICATION' };

  // 반려 후 재신청이 무제한이면 글쓴이를 계속 괴롭히는 용도로 악용될 수 있어, 한 글당 총
  // 신청 횟수(상태 무관 — 대기/수락/반려 전부 포함)를 3회로 제한한다.
  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM community_applications WHERE post_id = ? AND applicant_id = ?',
    [postId, applicantId]
  );
  if (count >= MAX_APPLICATIONS_PER_POST) return { ok: false, reason: 'APPLICATION_LIMIT_REACHED' };

  const [result] = await pool.query(
    "INSERT INTO community_applications (post_id, applicant_id, message, status) VALUES (?, ?, ?, 'pending')",
    [postId, applicantId, message]
  );
  return { ok: true, id: result.insertId };
}

// 내가 낸 신청 전체 — 수락된 건만 글쓴이 연락처를 같이 내려준다(매칭 성사 시에만 공개).
// 실제 이메일이 아니라 그 신청 건 전용 프록시 주소를 내려준다(#182 — 이메일 프록시) —
// 실제 이메일은 이 조회에서 아예 select하지 않는다.
async function getMyApplications(studentId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.post_id, a.message, a.status, a.created_at, a.decided_at,
            p.title AS post_title, p.category AS post_category, p.closed_at AS post_closed_at,
            s.name AS author_name, s.id AS author_id, ep.proxy_email AS contact_proxy_email
     FROM community_applications a
     JOIN community_posts p ON p.id = a.post_id
     JOIN students s ON s.id = p.author_id
     LEFT JOIN community_email_proxies ep ON ep.application_id = a.id AND ep.owner_id = p.author_id
     WHERE a.applicant_id = ?
     ORDER BY a.created_at DESC`,
    [studentId]
  );
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    postTitle: row.post_title,
    postCategory: row.post_category,
    postClosedAt: row.post_closed_at,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    author: nicknameOf(row.author_name, row.author_id),
    contactEmail: row.status === 'accepted' ? row.contact_proxy_email : null,
  }));
}

// 이 글에 달린 신청자 전체(작성자 전용 — 소유권 확인은 호출부가 getPostById로 먼저 함,
// 2단계 승인/반려 라우트와 동일 패턴). hasAppliedBefore는 같은 신청자가 이 글에 이전에도
// 신청한 적이 있는지(반려 후 재신청 포함) 표시 — 닉네임을 바꿔도 applicant_id는 고정이라
// 글쓴이가 "예전에 왔던 사람"인지 알아볼 수 있게 해준다.
async function getApplicantsForPost(postId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.applicant_id, a.message, a.status, a.created_at, a.decided_at, a.reject_reason,
            s.name AS applicant_name, ep.proxy_email AS contact_proxy_email
     FROM community_applications a
     JOIN students s ON s.id = a.applicant_id
     LEFT JOIN community_email_proxies ep ON ep.application_id = a.id AND ep.owner_id = a.applicant_id
     WHERE a.post_id = ?
     ORDER BY a.created_at ASC`,
    [postId]
  );
  const seenApplicants = new Set();
  return rows.map((row) => {
    const hasAppliedBefore = seenApplicants.has(row.applicant_id);
    seenApplicants.add(row.applicant_id);
    return {
      id: row.id,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      applicant: nicknameOf(row.applicant_name, row.applicant_id),
      hasAppliedBefore,
      contactEmail: row.status === 'accepted' ? row.contact_proxy_email : null,
      rejectReason: row.status === 'rejected' ? row.reject_reason : null,
    };
  });
}

// 승인/반려와 동일한 "가드 달린 UPDATE + affectedRows" 패턴(아래 decidePost 참고) —
// 다만 신청은 소유권이 글(community_posts.author_id)을 통해서만 확인되므로 JOIN해서
// 한 번에 검증한다. 대기중이 아닌 신청을 다시 수락/반려하는 것도 막는다. reason은 거부일
// 때만 의미가 있어 수락 시엔 항상 NULL로 저장한다(decidePost와 동일한 이유).
async function decideApplication(applicationId, authorId, status, reason = null) {
  const [result] = await pool.query(
    `UPDATE community_applications a
     JOIN community_posts p ON p.id = a.post_id
     SET a.status = ?, a.decided_at = NOW(), a.reject_reason = ?
     WHERE a.id = ? AND a.status = 'pending' AND p.author_id = ?`,
    [status, status === 'rejected' ? reason : null, applicationId, authorId]
  );
  if (result.affectedRows === 0) return false;

  if (status === 'accepted') {
    const [[application]] = await pool.query('SELECT applicant_id FROM community_applications WHERE id = ?', [
      applicationId,
    ]);
    await createEmailProxiesForApplication(applicationId, application.applicant_id, authorId);
  }
  return true;
}

// 관리자 화면(4단계)이 작성자를 author_id 숫자로만 보여주면 누가 쓴 글인지 알아볼 수
// 없어서, 학생용 목록(listApprovedPosts 등)과 동일하게 닉네임까지 조인해서 내려준다.
async function listPostsForAdmin(status) {
  const [rows] = await pool.query(
    `SELECT p.id, p.title, p.body, p.category, p.capacity, p.status, p.created_at, p.author_id, p.reject_reason, s.name AS author_name
     FROM community_posts p
     JOIN students s ON s.id = p.author_id
     WHERE p.status = ?
     ORDER BY p.created_at ASC`,
    [status]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.created_at,
    author: nicknameOf(row.author_name, row.author_id),
    rejectReason: row.reject_reason,
  }));
}

// status가 이미 'pending'이 아니면 아무 것도 안 바뀐다 — 이미 처리된 글을 다시
// 승인/반려하는 걸 막는 가드. affectedRows를 돌려줘서 호출부가 "존재하지 않거나 이미
// 처리된 글"을 실제 성공과 구분할 수 있게 한다(그렇지 않으면 관리자가 아무 효과 없는
// 요청에도 성공 응답을 받는다).
// reason은 반려일 때만 의미가 있어 승인 시엔 항상 NULL로 저장한다 — 이전에 반려됐다가
// 수정 후 재승인되는 경우 등, 예전 반려 사유가 새 결정에도 남아있지 않게 하기 위함.
async function decidePost(id, status, reason = null) {
  const [result] = await pool.query(
    "UPDATE community_posts SET status = ?, decided_at = NOW(), reject_reason = ? WHERE id = ? AND status = 'pending'",
    [status, status === 'rejected' ? reason : null, id]
  );
  return result.affectedRows > 0;
}

// 존재하지 않는 id를 삭제 시도해도 조용히 200이 나가지 않도록 affectedRows를 돌려준다.
async function deletePost(id) {
  const [result] = await pool.query('DELETE FROM community_posts WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = {
  createPost,
  listApprovedPosts,
  listMyPosts,
  getPostById,
  editPost,
  deletePostByAuthor,
  closePost,
  applyToPost,
  getMyApplications,
  getApplicantsForPost,
  decideApplication,
  findEmailRelayTarget,
  listPostsForAdmin,
  decidePost,
  deletePost,
};
