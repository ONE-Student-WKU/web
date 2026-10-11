# wku-ai-chat Entity Relationship Diagram (ERD)

기준은 `db/schema.sql`이다. 이 문서는 **FOREIGN KEY로 선언된 관계만** 그린다(컬럼 목록은 `schema.sql`이 원본이라 여기엔 옮기지 않는다 — 손으로 옮긴 컬럼 목록이 가장 먼저 낡는다). 스키마에 테이블이나 FK를 추가하면 이 문서도 같이 고친다.

`students`를 중심으로 한 계정 쪽 관계와, `departments`를 중심으로 한 학과·교육과정 쪽 관계로 나눠 그렸다.

## 학생 계정 중심

```mermaid
erDiagram
    students ||--o{ student_courses : "수강 기록 (CASCADE)"
    course_offerings |o--o{ student_courses : "개설 과목 (SET NULL)"
    student_courses ||--o{ student_course_schedules : "시간표"
    course_offerings ||--o{ course_offering_schedules : "시간표"
    students ||--o{ chat_conversations : "규정 챗봇"
    chat_conversations ||--o{ chat_messages : contains
    students ||--o{ career_sessions : "진로 탐색"
    career_sessions ||--o{ career_messages : contains
    career_sessions ||--o{ career_candidates : contains
    career_sessions ||--o{ career_roadmap_items : contains
    students ||--o{ inquiries : "문의"
    students ||--o{ student_activity : "활동 기록"
    students ||--o{ pdf_import_logs : "PDF 임포트 횟수"
    students ||--o{ student_sanctions : "제재 대상"
    students ||--o{ student_sanctions : "제재 부과(created_by)"
    community_reports |o--o{ student_sanctions : "근거 신고 (SET NULL)"
```

## 커뮤니티

```mermaid
erDiagram
    students ||--o{ community_posts : "글 작성"
    community_posts ||--o{ community_applications : "신청 받음"
    students ||--o{ community_applications : "신청자"
    community_applications ||--o{ community_email_proxies : "수락 시 프록시 2개"
    students ||--o{ community_email_proxies : "수신자(owner)"
    students ||--o{ community_reports : "신고자"
    students |o--o{ community_reports : "피신고자 (SET NULL)"
```

`community_email_proxies`는 신청 하나당 신청자·글쓴이 몫으로 정확히 2개여야 한다는 전제를 코드(`communityService.findEmailRelayTarget`)가 쓰지만, 이 전제를 DB 제약(UNIQUE)이 아니라 수락 트랜잭션(`acceptApplication`)이 지킨다.
`community_reports.target_id`는 글/신청을 가리키는 다형 참조라 FK가 없다(`target_type`으로 구분).

## 학과·교육과정 중심

```mermaid
erDiagram
    departments ||--o{ tracks : has
    departments |o--o{ students : "소속 (SET NULL)"
    departments |o--o{ students : "복수전공 (SET NULL)"
    tracks |o--o{ students : "트랙 (SET NULL)"
    departments ||--o{ course_offerings : offers
    tracks ||--o{ course_offerings : scopes
    departments ||--o{ curriculum_requirements : defines
    curriculum_requirements ||--o{ curriculum_required_courses : requires
    departments ||--o{ curriculum_courses : lists
    tracks ||--o{ curriculum_courses : scopes
    departments ||--o{ curriculum_changes : "변경 이력"
    tracks ||--o{ curriculum_changes : scopes
    departments |o--o{ curriculum_changes : "후속 학과 (SET NULL)"
    departments ||--o{ department_lineage : "학과 계보 (from/to)"
    tracks ||--o{ department_lineage : "트랙 계보 (from/to)"
    departments ||--o{ course_lineage : "과목 계보"
    linked_majors ||--o{ linked_major_courses : contains
    micro_degrees ||--o{ micro_degree_courses : contains
    regulation_documents ||--o{ regulation_chunks : "챗봇 검색용 조각"
```

FK로 이어지지 않는 독립 테이블: `sessions`(express-session 저장소), `email_login_tokens`(이메일 로그인 코드).
`linked_majors`, `micro_degrees`는 과목 테이블에만 연결되고 학과와는 FK가 없다.

## 규정 판단 엔진 (db/schema.sql 7.5절)

위 다이어그램들과 별개로, 아래는 규정 판단 엔진(`server/services/regulationEngine`)이 쓰는 테이블만 그린 것이다.
`regulation_documents`/`regulation_chunks`(챗봇 검색용, 재시딩 때 통째로 교체)와는 일부러 분리했다 — 이유는 `docs/regulation-engine/DECISIONS.md` D-24.

```mermaid
erDiagram
    regulation_versions ||--o{ regulation_articles : contains
    regulation_versions |o--o| regulation_versions : supersedes
    regulation_articles ||--o{ regulation_relations : "from"
    regulation_articles |o--o{ regulation_relations : "to"
    regulation_articles |o--o{ regulation_applicability : scoped_by
    departments |o--o{ course_equivalences : designates
    departments |o--o{ course_category_overrides : overrides

    regulation_versions {
        int id PK
        string doc_code
        string version_label
        date promulgated_on "공포일"
        date effective_from "시행일"
        date effective_to
        int supersedes_version_id FK
        bool text_held "본문 보유 여부"
        enum date_confidence "CONFIRMED/ESTIMATED/UNKNOWN"
    }

    regulation_articles {
        int id PK
        int version_id FK
        string article_key "제13조 / 부칙(2026.04.10.)제2조 / 별표4-3"
        enum section "BODY/ADDENDUM/SCHEDULE"
        text body
        json amendment_markers "개정·신설 표시"
        date last_amended_on
    }

    regulation_applicability {
        int id PK
        string rule_code UK
        int article_id FK
        enum scope "COHORT_ONLY/ALL_ENROLLED/TRANSITIONAL"
        date applies_from
        int min_admission_year
        int max_admission_year
        enum enrollment_type
        string condition_code
        json condition_params
        enum confidence
        bool critical "0이면 전체 신뢰도에서 제외"
    }

    regulation_relations {
        int id PK
        int from_article_id FK
        enum relation "REFERS/DELEGATES_TO/OVERRIDES/AMENDS"
        int to_article_id FK
        string to_ref "보유하지 않은 대상"
        enum source "PARSED/MANUAL"
    }

    course_equivalences {
        int id PK
        int department_id FK
        string from_course_key
        string to_course_key
        string basis_article_ref "제15조"
    }

    course_category_overrides {
        int id PK
        int department_id FK
        string course_key
        int academic_year
        int semester
        string category
        string basis_article_ref "제13조④"
    }
```
