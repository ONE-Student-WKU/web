import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n/I18nContext.jsx';
import ConsentGate from './ConsentGate.jsx';

const renderGate = (props) =>
  render(
    <LanguageProvider>
      <ConsentGate onAccepted={vi.fn()} onDecline={vi.fn()} onOpenPrivacy={vi.fn()} onOpenTerms={vi.fn()} {...props} />
    </LanguageProvider>
  );

describe('ConsentGate', () => {
  it('처음 동의하는 계정에는 바뀐 내용을 보여 주지 않는다', () => {
    renderGate({ renewal: false });
    expect(screen.queryByText('바뀐 내용')).toBeNull();
    expect(screen.getByText(/계속 이용하려면/)).toBeInTheDocument();
  });

  it('예전 버전에 동의한 계정에는 방침이 바뀌었다는 안내와 바뀐 내용을 보여 준다(방침 9항)', () => {
    renderGate({ renewal: true });
    expect(screen.getByText(/개인정보처리방침이 바뀌어서/)).toBeInTheDocument();
    expect(screen.getByText('바뀐 내용')).toBeInTheDocument();
    expect(screen.getByText(/진단 결과를 같이 보낼 수 있게 됐어요/)).toBeInTheDocument();
  });
});
