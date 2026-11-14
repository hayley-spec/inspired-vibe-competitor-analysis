import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { ScoreResult } from './analyze';

export interface ReportPdfInput {
  id: string;
  createdAt: string;
  ownUrl: string;
  competitorUrl: string;
  own: ScoreResult | null;
  competitor: ScoreResult;
}
const NAVY = '#022D41', TEAL = '#1AA6B7', RED = '#BF2D32';
// Normalize punctuation and control characters while retaining international names.
export function pdfText(value: unknown): string {
  return String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '?');
}
export function safeReportUrl(value: string): string | null {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export async function renderReportPdf(report: ReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({size:'A4', margin:48, bufferPages:true, info:{Title:'Competitive Presence Analysis', Author:'Inspired Vibe'}});
  doc.registerFont('Body',path.resolve('server/fonts/DejaVuSans.ttf'));
  doc.registerFont('Heading',path.resolve('server/fonts/DejaVuSans-Bold.ttf'));
  const chunks:Buffer[]=[];
  const output = new Promise<Buffer>((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const width=doc.page.width-96;
  const ensure=(height:number)=>{if(doc.y+height>doc.page.height-65)doc.addPage();};
  const text=(s:unknown,size=10,color=NAVY)=>{doc.font('Body').fontSize(size).fillColor(color).text(pdfText(s),{width,lineGap:3});doc.moveDown(.35);};
  const title=(s:string)=>{ensure(55);doc.font('Heading').fontSize(18).fillColor(NAVY).text(pdfText(s),{width});doc.moveDown(.5);};
  const link=(label:string,url:string)=>{const safe=safeReportUrl(url);if(!safe)return;ensure(35);doc.font('Body').fontSize(9).fillColor('#166375').text(pdfText(`${label}: ${safe}`),{width,link:safe,lineGap:2});doc.moveDown(.4);};
  doc.rect(0,0,doc.page.width,155).fill(NAVY);
  doc.fillColor('#ffffff').font('Heading').fontSize(13).text('INSPIRED VIBE',48,42);
  doc.fontSize(28).text('Competitive Presence\nAnalysis',48,70,{width});
  doc.y=180;
  text(`Generated ${report.createdAt} | Report ${report.id}`,9);
  text('A source-based comparison of your public presence and your selected competitor.',12);
  text('This is an evidence snapshot, not a measure of business quality or guaranteed performance. Missing or inaccessible information is not proof that an activity is absent. Leadership channels are attributed separately and are not assumed to belong to the company.',10);
  text('Signal scores use the same 1-10 display scale as the on-screen report, including a display floor of 1 for verified zero; underlying weighted scoring is unchanged. Unverified signals are not scored.',9);
  title('At a glance');
  for(const [label,result,url] of [['Your company',report.own,report.ownUrl],['Your competitor',report.competitor,report.competitorUrl]] as const){
    ensure(115);
    text(`${label}: ${result?.companyName||url}`,12);
    text(result?`${Number.isFinite(result.score)?result.score.toFixed(1):'Not scored'} / 10 | ${result.bandLabel||''} | Confidence: ${result.confidence||'not established'}`:'Not scored: your company could not be assessed; a reliable complete comparison is unavailable.',11);
    link('Website',url);
  }
  const company=(label:string,r:ScoreResult|null,url:string)=>{
    if(!r)return; // The missing-company warning is already prominent on the overview.
    doc.addPage();title(label);text(r.companyName||url,15);
    text(r.headline,12);text(r.rationale);text(r.confidenceNote);
    if(r.provisional)text('Provisional result: incomplete evidence or attribution limitations affect this assessment.',10,RED);
    text(`${r.pagesScanned ?? 'Unknown'} pages scanned | ${r.evidenceCoverage ?? 'Unknown'}% evidence coverage`,9);
    for(const p of r.pillars){
      ensure(100);
      doc.moveTo(48,doc.y).lineTo(doc.page.width-48,doc.y).strokeColor(TEAL).stroke();doc.moveDown(.7);
      const score=p.status==='unverified'||!Number.isFinite(p.earned)||!Number.isFinite(p.max)||p.max<=0||p.earned<0||p.earned>p.max?'Not scored':`${Math.max(1,p.earned/p.max*10).toFixed(1)} / 10`;
      doc.font('Heading').fontSize(12).fillColor(NAVY).text(pdfText(`${p.label}: ${score}`));doc.moveDown(.4);
      text(p.summary); if(p.consequence)text(`Why it matters: ${p.consequence}`);
      for(const evidence of p.evidence)text(`- ${evidence}`,9);
    }
    ensure(100);title('Priorities and interpretation');text(r.biggestGap);text(r.recommendation);
    for(const note of r.presenceNotes||[])text(`- ${note}`,9);
    title('Founder and owner footprint');
    const footprint=r.founderFootprint;
    if(!footprint||footprint.status!=='found')text('Founder/owner identity and associated profiles were not verified in the accessible pages; this does not establish that they are absent.');
    else{
      text(footprint.note);
      for(const person of footprint.people){ensure(80);text(`${person.name} | ${person.role}`,12);text(person.excerpt);link('Company role evidence',person.sourceUrl);
        for(const profile of person.profiles){link(`${profile.platform} profile`,profile.url);link('Association evidence',profile.sourceUrl);text(profile.metrics.length?profile.metrics.map(m=>`${m.approximate?'Approximately ':''}${m.value} ${m.name}`).join('; '):'Public metrics unavailable.',9);}
        for(const podcast of person.podcasts){link('Associated podcast',podcast.url);link('Association evidence',podcast.sourceUrl);text(podcast.latestEpisode?`Latest readable episode: ${podcast.latestEpisode.slice(0,10)}`:'Podcast cadence unverified.',9);}
      }
    }
    if(footprint?.limited)text('Leadership discovery was incomplete or a source was unavailable; coverage is partial.',10,RED);
    title('Source register');
    for(const source of r.sources||[]){link(`${source.kind} (${source.status})`,source.url);}
  };
  company('Your company',report.own,report.ownUrl);company('Your competitor',report.competitor,report.competitorUrl);
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.save();const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.font('Body').fontSize(8).fillColor('#687780').text(`Inspired Vibe | Competitive Presence Analysis | ${i+1} / ${range.count}`,48,doc.page.height-40,{width,lineBreak:false});doc.page.margins.bottom=bottom;doc.restore();}
  doc.end();return output;
}
