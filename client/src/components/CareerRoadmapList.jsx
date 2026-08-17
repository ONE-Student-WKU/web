import React from 'react';

// CareerExploration.jsx(진로 탐색 결과 화면)와 Profile.jsx(확정한 진로 다시 보기)가
// 같은 형태로 로드맵을 보여줘야 해서 공용 컴포넌트로 뺐다.
export function groupRoadmapBySemester(roadmap) {
  const sorted = [...roadmap].sort((a, b) => a.grade - b.grade || a.semester - b.semester);
  const groups = [];
  for (const item of sorted) {
    const label = `${item.grade}학년 ${item.semester}학기`;
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
 * - roadmap: [{grade, semester, courseName, reason}]
 */
function CareerRoadmapList({ roadmap }) {
  const groups = groupRoadmapBySemester(roadmap);

  if (groups.length === 0) {
    return <p className="onb-q-sub">추천할 만한 남은 과목을 찾지 못했어요.</p>;
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
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export default CareerRoadmapList;
