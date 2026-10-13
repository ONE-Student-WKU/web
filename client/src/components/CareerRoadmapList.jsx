import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

// CareerExploration.jsx(진로 탐색 결과 화면)와 Profile.jsx(확정한 진로 다시 보기)가
// 같은 형태로 로드맵을 보여줘야 해서 공용 컴포넌트로 뺐다.
// t를 넘기면(화면 언어 번역 함수) 그 언어로 학기 이름을 만든다 — 안 넘기면 기존 한국어 그대로.
// eslint-disable-next-line react-refresh/only-export-components -- 다른 화면이 재사용하는 순수 헬퍼라 의도적으로 컴포넌트와 같이 export함.
export function groupRoadmapBySemester(roadmap, t = null) {
  const sorted = [...roadmap].sort((a, b) => a.grade - b.grade || a.semester - b.semester);
  const groups = [];
  for (const item of sorted) {
    const label = t ? t('career.roadmapGroup', { grade: item.grade, semester: item.semester }) : `${item.grade}학년 ${item.semester}학기`;
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * CareerRoadmapList Component
 * 확정된 진로에 맞춰 추천된 남은 과목 로드맵을 학기별로 그룹지어 보여준다.
 *
 * Props:
 * - roadmap: [{grade, semester, courseName, reason, syllabusUrl}]
 *   syllabusUrl은 서버가 만든 학교 "수업계획서 조회" 검색 링크(학수번호를 못 찾으면 null — 그때는 링크를 안 그린다).
 */
function CareerRoadmapList({ roadmap }) {
  const { t } = useI18n();
  const groups = groupRoadmapBySemester(roadmap, t);

  if (groups.length === 0) {
    return <p className="onb-q-sub">{t('career.roadmapEmpty')}</p>;
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="career-roadmap-group">
          <span className="career-roadmap-label">{group.label}</span>
          {group.items.map((item) => (
            <div key={item.courseName} className="home-card career-roadmap-item">
              <span className="career-roadmap-course">{item.courseName}</span>
              {item.reason && <span className="career-roadmap-reason">{item.reason}</span>}
              {item.syllabusUrl && (
                <a className="career-roadmap-syllabus" href={item.syllabusUrl} target="_blank" rel="noopener noreferrer">
                  {t('career.roadmapSyllabus')}
                </a>
              )}
            </div>
          ))}
        </div>
      ))}
      {/* 추천 이유는 과목명만 보고 쓴 설명이라 실제 수업 내용과 다를 수 있다 — 계획서로 확인하도록 안내한다. */}
      <p className="career-roadmap-note">{t('career.roadmapReasonNote')}</p>
    </>
  );
}

export default CareerRoadmapList;
