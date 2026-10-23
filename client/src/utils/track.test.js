import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { track, flush, setTrackingEnabled, installTracking } from './track.js';

/**
 * client/src/utils/track.test.js
 * 기능 사용 횟수: 로그인한 학생일 때만 세고, 15초 모아 한 번에 보내며, 보내는 내용은 이름별 횟수와
 * "이 기기에서 오늘 처음 쓴 이름"뿐이다(누가·언제·무엇을 입력했는지는 없다).
 */

let uninstall;
const sentBodies = () => globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  uninstall = installTracking();
});

afterEach(() => {
  setTrackingEnabled(false);
  flush();
  uninstall();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('track', () => {
  it('꺼져 있으면(로그인 전·관리자) 아무것도 보내지 않는다', () => {
    track('home.menu.courses');
    vi.advanceTimersByTime(20000);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('15초 동안 모아 이름별 횟수로 한 번에 보낸다', () => {
    setTrackingEnabled(true);
    track('home.menu.courses');
    track('home.menu.courses');
    track('tabbar.career');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/ui-events');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ counts: { 'home.menu.courses': 2, 'tabbar.career': 1 }, devices: ['home.menu.courses', 'tabbar.career'] });
  });

  it('같은 기기에서 같은 날 두 번째부터는 기기 수에 넣지 않는다', () => {
    setTrackingEnabled(true);
    track('home.menu.courses');
    flush();
    track('home.menu.courses');
    flush();
    expect(sentBodies()[1]).toEqual({ counts: { 'home.menu.courses': 1 }, devices: [] });
  });

  it('규칙에 맞지 않는 이름은 세지 않는다', () => {
    setTrackingEnabled(true);
    track('Home.Menu');
    track('home');
    track('home.메뉴');
    flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('data-track이 붙은 버튼(안쪽 아이콘을 눌러도)을 누르면 센다', () => {
    setTrackingEnabled(true);
    document.body.innerHTML = '<button data-track="tabbar.community"><svg><path id="icon"></path></svg></button><button id="plain">x</button>';
    document.getElementById('icon').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('plain').click();
    flush();
    expect(sentBodies()).toEqual([{ counts: { 'tabbar.community': 1 }, devices: ['tabbar.community'] }]);
  });

  it('화면이 숨겨지거나 기록을 끄면 남은 것을 바로 보낸다', () => {
    setTrackingEnabled(true);
    track('view.home');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    track('view.chat');
    setTrackingEnabled(false);
    expect(sentBodies().map((b) => Object.keys(b.counts))).toEqual([['view.home'], ['view.chat']]);
  });

  it('브라우저 저장소가 막혀 있어도 횟수는 센다(기기 수만 빠진다)', () => {
    setTrackingEnabled(true);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    track('home.edit');
    flush();
    spy.mockRestore();
    expect(sentBodies()).toEqual([{ counts: { 'home.edit': 1 }, devices: [] }]);
  });
});
