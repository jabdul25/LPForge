export type LogLevel = 'debug'|'info'|'warn'|'error';
const order: Record<LogLevel, number> = {debug:10,info:20,warn:30,error:40};
const REDACT_KEYS = new Set(['password','secret','privateKey','seedPhrase','authorization','token','apiKey','walletSecret']);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k,v] of Object.entries(value as Record<string, unknown>)) out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : sanitize(v);
    return out;
  }
  return typeof value === 'bigint' ? value.toString() : value;
}

export class Logger {
  constructor(private readonly component: string, private readonly minLevel: LogLevel = 'info') {}
  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    if (order[level] < order[this.minLevel]) return;
    const line = sanitize({ts:new Date().toISOString(),level,component:this.component,event,...fields});
    console.log(JSON.stringify(line));
  }
  debug(event: string, fields: Record<string, unknown> = {}) { this.log('debug',event,fields); }
  info(event: string, fields: Record<string, unknown> = {}) { this.log('info',event,fields); }
  warn(event: string, fields: Record<string, unknown> = {}) { this.log('warn',event,fields); }
  error(event: string, fields: Record<string, unknown> = {}) { this.log('error',event,fields); }
}
export function requestId(): string { return crypto.randomUUID(); }
