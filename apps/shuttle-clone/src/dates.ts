export function parisToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function pickupIsPast(date: string, time: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
    second: '2-digit', fractionalSecondDigits: 3,
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  const currentTime = `${part('hour')}:${part('minute')}:${part('second')}.${part('fractionalSecond')}`;
  return `${date}T${time}:00.000` < `${parisToday(now)}T${currentTime}`;
}
