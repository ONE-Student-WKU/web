import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PrivacyPolicy from './PrivacyPolicy.jsx';
import TermsOfService from './TermsOfService.jsx';

/**
 * client/src/pages/LegalDocs.test.jsx
 * 개인정보처리방침과 이용약관이 현재 서비스(이메일 로그인, 위탁·국외 이전 사업자, 커뮤니티 규칙)를 담고 있는지,
 * 문의 이메일이 현재 운영 이메일인지 확인한다. 서비스에 외부 사업자나 로그인 수단을 추가하면 이 문서와 이 테스트를 같이 고친다.
 */

const CONTACT = 'contact@onestudent.io.kr';

describe('개인정보처리방침', () => {
  it('문의 이메일이 현재 운영 이메일이고 옛 이메일은 없다', () => {
    const { container } = render(<PrivacyPolicy onGoBack={() => {}} />);
    const links = [...container.querySelectorAll('a[href^="mailto:"]')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([`mailto:${CONTACT}`]);
    expect(container.textContent).not.toContain('bedelj3');
  });

  it('이메일 인증코드 로그인과 서비스가 실제로 쓰는 외부 사업자를 모두 적고 있다', () => {
    const { container } = render(<PrivacyPolicy onGoBack={() => {}} />);
    const text = container.textContent;
    expect(text).not.toContain('Google 로그인만을 통해');
    expect(text).toContain('이메일 인증코드 로그인');
    for (const vendor of ['Railway', 'Vercel', 'Anthropic', 'Voyage AI', 'Resend', 'Sentry', 'Google']) {
      expect(text, vendor).toContain(vendor);
    }
    expect(text).toContain('국외 이전');
  });

  it('수집 항목에 커뮤니티·문의·성적·동의 기록이 들어 있다', () => {
    const { container } = render(<PrivacyPolicy onGoBack={() => {}} />);
    const text = container.textContent;
    for (const item of ['커뮤니티 글', '문의하기', '성적 등급', '동의한 시각']) expect(text, item).toContain(item);
  });

  // 코드와 어긋나지 않게: 성적표는 이름·학번을 지운 글자만 AI로 보내고(server/services/pdfImportService.js),
  // 접속한 날짜는 14일만 두며(visitStatsService.js), 기능 사용 횟수는 누가 썼는지 없이 센다(uiEventService.js).
  it('성적표 가져오기의 AI 전송 범위, 접속 날짜 보관 기간, 기능 사용 횟수를 적어 두었다', () => {
    const { container } = render(<PrivacyPolicy onGoBack={() => {}} />);
    const text = container.textContent.replace(/\s+/g, ' ');
    for (const item of ['이름과 학번은 지운 뒤에 보냅니다', 'PDF 파일 자체는 보내지 않습니다', '최근 14일만 보관', '누가 썼는지와 쓴 시각', '각 사업자의 정책에 따라']) {
      expect(text, item).toContain(item);
    }
  });

  // 운영 보조 AI 분류(#458)와 서비스 전체 이용 정지(#457)는 기능보다 먼저 동의를 받는다(2026-10-26). 만들 때 이 문장과 어긋나지 않게.
  it('AI 사전 분류의 전송 범위·보관, 이용 제한 기록, 정지 중 탈퇴 시 재가입 방지 정보를 적어 두었다', () => {
    const { container } = render(<PrivacyPolicy onGoBack={() => {}} />);
    const text = container.textContent.replace(/\s+/g, ' ');
    for (const item of ['AI 분류 결과', '운영팀이 직접 판단', '부적절한 내용 사전 분류', '계정 정보는 보내지 않음', '이용 제한 기록', '서비스 전체 이용 정지', '삭제한 날부터 1년', '작성자와 연결되지 않은']) {
      expect(text, item).toContain(item);
    }
  });

  it('개인정보 보호책임자와 시행일이 있다', () => {
    const { container } = render(<PrivacyPolicy onGoBack={() => {}} />);
    // 시행일은 마지막 개정일(2026-10-28)이다.
    expect(screen.getByText(/시행일: 2026년 10월 28일/)).toBeInTheDocument();
    // 2026-10-27: 수집 항목에 연계·복합전공과 이수 중인 마이크로디그리를 넣었다(#412).
    expect(container.textContent).toContain('다전공(복수전공·부전공) 학과 또는 연계·복합전공과 그 구분, 이수 중인 마이크로디그리');
    expect(screen.getAllByText(/개인정보 보호책임자/).length).toBeGreaterThan(0);
  });
});

describe('이용약관', () => {
  it('문의 이메일이 현재 운영 이메일이고 옛 이메일은 없다', () => {
    const { container } = render(<TermsOfService onGoBack={() => {}} />);
    const links = [...container.querySelectorAll('a[href^="mailto:"]')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([`mailto:${CONTACT}`]);
    expect(container.textContent).not.toContain('bedelj3');
  });

  it('이메일 로그인, 커뮤니티 규칙(승인·신고·제재), AI 답변의 한계를 담고 있다', () => {
    const { container } = render(<TermsOfService onGoBack={() => {}} />);
    const text = container.textContent;
    expect(text).not.toContain('Google 계정으로 로그인해야 합니다');
    for (const item of ['이메일 인증코드', '커뮤니티 이용 규칙', '신고', '이용 정지', 'AI가 만들기', '추정', '본인의 성적표만']) {
      expect(text, item).toContain(item);
    }
  });

  it('이용 제한 조항: 서비스 전체 이용 정지, 정지 중에도 계정 삭제 가능, 재가입 제한, AI 분류만으로 제한하지 않음, 서비스 어디서든 욕설 금지', () => {
    const { container } = render(<TermsOfService onGoBack={() => {}} />);
    const text = container.textContent.replace(/\s+/g, ' ');
    for (const item of ['6. 이용 제한', '서비스 전체 이용 정지', '계정 삭제는 할 수 있습니다', '다시 가입할 수 없습니다', 'AI 분류만으로 정하지 않고', '서비스 어디에서든', '시행일: 2026년 10월 28일']) {
      expect(text, item).toContain(item);
    }
  });
});
