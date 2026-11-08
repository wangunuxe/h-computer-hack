// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('showcase renderer', () => {
  it('autoplays mock, resets on pair, renders real/empty/error/payment states, and resumes mock on unpair', () => {
    const html = readFileSync(new NodeURL('../showcase.html', import.meta.url), 'utf8');
    document.documentElement.innerHTML = html.replace(/<link\b[^>]*>/g, '');
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class { observe() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const labels: { text: string; color: string }[] = [];
    const context = new Proxy({ fillStyle: '', fillText(text: string) { labels.push({ text, color: this.fillStyle }); }, measureText: () => ({ width: 10 }) }, { get: (target, key) => key in target ? Reflect.get(target, key) : vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    new Function(html.split('<script>')[1]!.split('</script>')[0]!)();
    const get = (id: string) => document.getElementById(id)!;
    const mode = (paired: boolean) => window.dispatchEvent(new CustomEvent('showcase-mode', { detail: { paired, stage: 'LISTEN' } }));
    const event = (value: unknown) => window.dispatchEvent(new CustomEvent('showcase-event', { detail: value }));
    expect(get('play').textContent).toBe('Pause'); expect(get('log').textContent).toContain('gladia.live');
    mode(true); expect(document.querySelector<HTMLElement>('.hud')!.hidden).toBe(true); expect(get('log').children).toHaveLength(0);
    expect(get('hear').textContent).not.toContain('Nicolas'); expect(get('pvLive').style.fontSize).toBe('30px');
    event({ type: 'stage', stage: 'EXECUTE' }); vi.mocked(requestAnimationFrame).mock.calls[0]![0](1000);
    expect(labels).toContainEqual({ text: 'Traveler', color: '#141B2B' }); expect(labels).toContainEqual({ text: 'Execute', color: '#141B2B' }); expect(labels).toContainEqual({ text: 'Confirm', color: '#5E6B82' });
    document.querySelector<HTMLButtonElement>('#chips button')!.click(); expect(get('hear').textContent).not.toContain('Nicolas');
    event({ type: 'say', text: 'Real narration' }); expect(get('hear').textContent).toContain('Real narration');
    event({ type: 'options', items: [] }); expect(get('pvLive').textContent).toBe('No options available.');
    event({ type: 'options', items: [{ name: 'Taxi to Bercy', price: 30, pickup_wait_minutes: 5, journey_minutes: 25 }] }); expect(get('pvLive').textContent).toContain('Estimated €30');
    event({ type: 'agent_step', action: 'Selecting vehicle', url: 'https://shuttle.example/fr/reservation/…/vehicle' }); expect(get('bwStat').textContent).toContain('/vehicle'); expect(get('pvLive').textContent).toBe('Selecting vehicle');
    event({ type: 'confirm', summary: '<img src=x onerror=alert(1)>' }); expect(get('pvLive').querySelector('img')).toBeNull();
    event({ type: 'payment_handoff', merchant: 'Shuttle', amount: 61.5 }); expect(get('pvLive').textContent).toBe('Shuttle\n€61.5');
    event({ type: 'booking_card', booking: { ref: 'PAS-123' } }); expect(get('pvLive').textContent).toContain('PAS-123');
    event({ type: 'error', message: 'Connection problem' }); expect(get('caption').textContent).toBe('Connection problem');
    mode(false); expect(document.querySelector<HTMLElement>('.hud')!.hidden).toBe(false); expect(get('play').textContent).toBe('Pause'); expect(get('log').textContent).toContain('gladia.live');
  });
});
