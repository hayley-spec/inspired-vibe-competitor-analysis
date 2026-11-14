import type { Express, Request } from 'express';
import { createHash } from 'node:crypto';
import { pool } from './storage-postgres';
import { analyze } from './analyze';
import { assessWebsites, websiteUrl } from '../client/src/lib/website-assessment';
import { renderReportPdf } from './report-pdf';

let initialized: Promise<unknown> | undefined;
async function db() {
  if (!pool) throw new Error('Report database unavailable');
  if (!initialized) initialized = pool.query(`CREATE TABLE IF NOT EXISTS iv_competitor_reports (
    id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), email TEXT NOT NULL,
    own_url TEXT NOT NULL, competitor_url TEXT NOT NULL, ip_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing', result JSONB, email_status TEXT NOT NULL DEFAULT 'pending',
    email_id TEXT, error TEXT)`);
  try { await initialized; } catch (e) { initialized = undefined; throw e; }
  return pool;
}
export function validateReport(body: any) {
  if (typeof body?.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw new Error('Enter a valid email address.');
  if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) throw new Error('Please refresh the page and try again.');
  if (typeof body.own !== 'string' || typeof body.competitor !== 'string' || body.own.length>300 || body.competitor.length>300) throw new Error('Enter both website addresses.');
  return { id: body.id, email: body.email.trim().toLowerCase(), ownUrl: websiteUrl(body.own), competitorUrl: websiteUrl(body.competitor) };
}
export function reportEmailEnabled() { return Boolean(process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL && process.env.REPORT_EMAIL_ENABLED === 'true'); }
export async function sendReport(row: any, pdf: Buffer, request: typeof fetch = fetch) {
  if (!reportEmailEnabled()) return {status:'awaiting_configuration'};
  const response = await request('https://api.resend.com/emails', {
    method:'POST', signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':`analysis-report/${row.id}`},
    body:JSON.stringify({from:process.env.REPORT_FROM_EMAIL, to:[row.email], subject:'Your Competitive Presence Analysis',
      text:'Your Competitive Presence Analysis is attached. It reflects the public evidence available at the time of analysis; missing evidence is not proof that a capability does not exist.\n\nBook your review: https://buildyourbusiness.inspiredvibe.com/m-ca-booking',
      attachments:[{filename:'competitive-presence-analysis.pdf', content:pdf.toString('base64')}]}),
  });
  if (!response.ok) return {status: response.status >=500 || response.status===429 ? 'delivery_uncertain' : 'rejected'};
  const data = await response.json() as {id?:string};
  return data.id ? {status:'accepted',id:data.id} : {status:'delivery_uncertain'};
}
export function registerReportRoutes(app: Express, requireAdmin:(req:Request)=>boolean) {
  app.get('/api/report-capabilities', (_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({emailEnabled:reportEmailEnabled()});});
  app.post('/api/reports', async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    let input:ReturnType<typeof validateReport>;
    try { input=validateReport(req.body); } catch(e) { return res.status(400).json({error:(e as Error).message}); }
    let database;
    let ownsClaim = false;
    try {
      database=await db();
      const ipHash=createHash('sha256').update(`${process.env.SESSION_SECRET}:${req.ip}`).digest('hex');
      const client=await database.connect();
      let existing;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`email:${input.email}`]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ip:${ipHash}`]);
        existing=(await client.query('SELECT * FROM iv_competitor_reports WHERE id=$1',[input.id])).rows[0];
        if (!existing) {
          const count=await client.query("SELECT count(*)::int AS count FROM iv_competitor_reports WHERE (ip_hash=$1 OR email=$2) AND created_at > now()-interval '1 hour'",[ipHash,input.email]);
          if(count.rows[0].count>=3) {await client.query('ROLLBACK'); return res.status(429).json({error:'Please wait before requesting another report.'});}
          await client.query('INSERT INTO iv_competitor_reports(id,email,own_url,competitor_url,ip_hash) VALUES($1,$2,$3,$4,$5)',[input.id,input.email,input.ownUrl,input.competitorUrl,ipHash]);
        }
        await client.query('COMMIT');
        ownsClaim = !existing;
      } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
      if(existing) {
        // Never expose an existing report from a guessed/reused request identifier.
        return res.status(409).json({error:'This report request has already been received; check your email or contact the team.'});
      }
      const result=await assessWebsites(input.ownUrl,input.competitorUrl,url=>analyze(url));
      const report={...input,...result,createdAt:new Date().toISOString()};
      await database.query("UPDATE iv_competitor_reports SET status='ready',result=$2 WHERE id=$1",[input.id,JSON.stringify(report)]);
      let delivery:{status:string,id?:string};
      let pdf:Buffer|undefined;
      try {pdf=await renderReportPdf(report);} catch { /* no email attempted */ }
      if (!pdf) delivery={status:'pdf_failed'};
      else { try {delivery=await sendReport(report,pdf);} catch {delivery={status:'delivery_uncertain'};} }
      await database.query('UPDATE iv_competitor_reports SET email_status=$2,email_id=$3 WHERE id=$1',[input.id,delivery.status,delivery.id??null]);
      return res.json({...result,reportId:input.id,emailStatus:delivery.status});
    } catch {
      if(database && ownsClaim) await database.query("UPDATE iv_competitor_reports SET status=CASE WHEN result IS NULL THEN 'failed' ELSE status END,error='Report processing interrupted' WHERE id=$1",[input.id]).catch(()=>{});
      return res.status(503).json({error:'We could not complete your report right now; please contact the team before resubmitting.'});
    }
  });
  app.get('/api/admin/reports',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!requireAdmin(req))return res.status(401).json({error:'Not authorised'});
    try { const database=await db(); const rows=(await database.query('SELECT id,created_at,email,own_url,competitor_url,status,email_status,email_id,error FROM iv_competitor_reports ORDER BY created_at DESC LIMIT 200')).rows;return res.json(rows);}
    catch{return res.status(503).json({error:'Reports unavailable'});}
  });
  app.get('/api/admin/reports/:id/pdf',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!requireAdmin(req))return res.status(401).json({error:'Not authorised'});
    if(!/^[0-9a-f-]{36}$/i.test(String(req.params.id)))return res.status(400).end();
    try {const database=await db();const row=(await database.query('SELECT result FROM iv_competitor_reports WHERE id=$1',[req.params.id])).rows[0];
      if(!row?.result)return res.status(404).json({error:'Report not ready'});
      res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="competitive-presence-analysis.pdf"');return res.send(await renderReportPdf(row.result));
    }catch{return res.status(503).json({error:'Report unavailable'});}
  });
}
