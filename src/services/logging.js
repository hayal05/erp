// Operational logs intentionally omit exception text/stacks, URLs, bodies, SQL parameters and credentials.
const EVENTS=new Set(['request','database','migration','seed']);
const CODES=new Set(['23001','23505','23503','23514','23P01','40001','40P01','42P01','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND']);
export function reportFailure(event,error){
 const source=EVENTS.has(event)?event:'operation';
 const code=CODES.has(error?.code)?error.code:'internal_error';
 console.error(`[${source}] failed (${code})`);
}
