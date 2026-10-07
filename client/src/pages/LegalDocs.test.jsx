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

const CONTACT = 'sicnro3241@gmail.com';

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

  it('개인정보 보호책임자와 시행일이 있다', () => {
    render(<PrivacyPolicy onGoBack={() => {}} />);
    expect(screen.getByText(/시행일: 2026년 10월 7일/)).toBeInTheDocument();
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
    for (const item of ['이메일 인증코드', '커뮤니티 이용 규칙', '신고', '이용 정지', 'AI가 만들기', '추정']) {
      expect(text, item).toContain(item);
    }
  });
});
