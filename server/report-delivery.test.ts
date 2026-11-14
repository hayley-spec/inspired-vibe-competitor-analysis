import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReport,sendReport} from './reports';
const valid={id:'d0288cd6-ea49-4977-bcb7-4cc2014dd6ab',own:'example.com',competitor:'example.org',email:'person@example.com'};
test('validates email request identity and URL safety',()=>{
 assert.equal(validateReport(valid).ownUrl,'https://example.com/');
 for(const patch of [{email:'x\nBcc:y@a.com'},{id:'nope'},{own:'http://127.0.0.1/'},{competitor:'https://user:pass@example.com'}])assert.throws(()=>validateReport({...valid,...patch}));
});
test('disabled delivery does not contact provider',async()=>{
 delete process.env.REPORT_EMAIL_ENABLED;
 assert.equal((await sendReport(valid,Buffer.from('pdf'),async()=>{throw Error('must not fetch')})).status,'awaiting_configuration');
});
test('provider delivery is idempotent attachment is encoded and acceptance is not delivery',async()=>{
 process.env.RESEND_API_KEY='test';process.env.REPORT_FROM_EMAIL='reports@report.example.com';process.env.REPORT_EMAIL_ENABLED='true';
 const result=await sendReport(valid,Buffer.from('pdf'),async(url,init)=>{
  assert.equal(url,'https://api.resend.com/emails');
  assert.equal((init!.headers as any)['Idempotency-Key'],`analysis-report/${valid.id}`);
  const body=JSON.parse(init!.body as string);assert.deepEqual(body.to,[valid.email]);assert.equal(body.attachments[0].content,Buffer.from('pdf').toString('base64'));
  return new Response(JSON.stringify({id:'mail-1'}),{status:200});
 });assert.equal(result.status,'accepted');
 assert.equal((await sendReport(valid,Buffer.from('pdf'),async()=>new Response('',{status:503}))).status,'delivery_uncertain');
 delete process.env.RESEND_API_KEY;delete process.env.REPORT_FROM_EMAIL;delete process.env.REPORT_EMAIL_ENABLED;
});
