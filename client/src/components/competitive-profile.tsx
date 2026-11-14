import React, { type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { VisibilityLogo, VisibilityStar } from "./visibility-brand";

export interface CompetitiveProfileProps {
  emailEnabled?: boolean;
  email?: string;
  onEmailChange?: (value:string)=>void;
  ownUrl: string;
  competitorUrl: string;
  onOwnUrlChange: (value: string) => void;
  onCompetitorUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset?: () => void;
  isPending: boolean;
  error?: string | null;
}

const navy = "hsl(var(--brand-navy))";
const accent = "hsl(var(--brand-red))";
const heading = { fontFamily: 'Balboa, "Arial Narrow", sans-serif' };

function BrandHeader() {
  return <header className="visibility-header">
    <VisibilityStar />
    <a href="https://inspiredvibe.com" target="_blank" rel="noopener noreferrer" className="min-w-0"><VisibilityLogo /></a>
  </header>;
}

export function ProcessingComparison({ ownUrl, competitorUrl }: Pick<CompetitiveProfileProps, "ownUrl" | "competitorUrl">) {
  return <main className="competitive-brand min-h-screen bg-white" style={{ color: navy }}>
    <section style={{ background: navy }} className="text-white">
      <BrandHeader />
      <div className="mx-auto max-w-6xl px-6 pb-12 pt-8 sm:px-10 sm:pb-16" role="status" aria-live="polite">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-white" style={heading}>Competitive Presence Analysis</p>
        <LoaderCircle className="mt-8 h-10 w-10 animate-spin" aria-hidden="true" style={{ color: accent }} />
        <h1 className="mt-5 max-w-3xl text-4xl font-bold uppercase leading-tight sm:text-6xl" style={heading}>Comparing your company <span className="competitive-highlight">and your selected competitor…</span></h1>
        <p className="mt-7 text-base">Your details have been submitted.</p>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/85">We’re reviewing all available public information for your company and your selected competitor using the same scoring criteria.</p>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/85">The comparison will give you a starting point for understanding what buyers can learn before they speak with your team.</p>
      </div>
    </section>
    <section className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
      <h2 className="text-3xl font-bold uppercase" style={heading}>Comparison details</h2>
      <dl className="mt-7 grid gap-7 sm:grid-cols-2">
        <div><dt className="text-sm font-semibold">Your company</dt><dd className="mt-2 break-all text-sm">{ownUrl}</dd></div>
        <div><dt className="text-sm font-semibold">Your selected competitor</dt><dd className="mt-2 break-all text-sm">{competitorUrl}</dd></div>
      </dl>
      <p className="mt-9 border-l-2 pl-4 text-sm leading-relaxed" style={{ borderColor: accent }}>The comparison looks at what is publicly available, not everything either company knows or delivers.</p>
    </section>
  </main>;
}

export function CompetitiveProfile(props: CompetitiveProfileProps) {
  const { ownUrl, competitorUrl, onOwnUrlChange, onCompetitorUrlChange, onSubmit, isPending, error } = props;
  if (isPending) return <ProcessingComparison ownUrl={ownUrl} competitorUrl={competitorUrl} />;
  const inputClass = "mt-3 block min-h-12 w-full rounded-sm border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/25";
  return <main className="competitive-brand min-h-screen bg-white" style={{ color: navy }}>
    <section className="competitive-hero relative overflow-hidden text-white" style={{ background: navy }}>
      <BrandHeader />
      <div className="mx-auto grid max-w-6xl gap-8 px-6 pb-14 pt-8 sm:px-10 sm:pt-8 md:grid-cols-2 md:gap-14 md:pb-20">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-white" style={heading}>Competitive Presence Analysis</p>
          <h1 className="mt-5 max-w-lg text-4xl font-bold uppercase leading-[1.05] sm:text-5xl lg:text-6xl" style={heading}>You’ve watched the masterclass. <span className="competitive-highlight">Now see how your company compares.</span></h1>
          <div className="mt-6"><VisibilityStar /></div>
        </div>
        <div className="space-y-5 text-sm leading-relaxed text-white/90 sm:text-base md:pt-8">
          <p>Enter your company’s website and the website of one competitor your buyers would consider with you.</p>
          <p>We’ll compare both companies using the same public signals and show the existing weighted scores side by side. See where your company scores higher, where your competitor scores higher, and where the comparison deserves a closer look.</p>
          <p className="font-semibold text-white">You don’t need to diagnose the problem first. Start with the two websites below. We’ll take it from there.</p>
        </div>
      </div>

    </section>

    <form onSubmit={onSubmit} noValidate>
      <section className="mx-auto max-w-6xl px-6 py-10 sm:px-10 sm:py-14">
        <h2 className="text-lg font-semibold">Start with both websites.</h2>
        <p className="mt-2 text-sm text-slate-500">Enter both websites and your report contact email.</p>
        <div data-testid="website-input-sections" className="mt-10 grid grid-cols-1 gap-10 md:gap-16">
          <section className="flex flex-col border-t-[3px] pt-5" style={{ borderColor: navy }}>
            <h3 className="text-3xl font-bold uppercase" style={heading}>Your company</h3>
            <p className="mt-4 font-semibold">Show us where buyers can find you.</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">Enter your company’s website.</p>
            <div className="mt-7">
              <label htmlFor="profile-own-url" className="text-sm font-semibold">Your Company’s Website <span className="text-brand-red" aria-hidden="true">*</span></label>
              <input id="profile-own-url" name="ownUrl" data-testid="input-own-url" type="text" inputMode="url" autoComplete="url" required maxLength={300} value={ownUrl} onChange={e => onOwnUrlChange(e.target.value)} placeholder="Your company website" aria-describedby="profile-own-help" className={inputClass} />
              <p id="profile-own-help" className="mt-3 text-xs leading-relaxed text-slate-500">Use the main website buyers visit to learn about your business and your approach.</p>
            </div>
          </section>
          <section className="flex flex-col border-t-[3px] pt-5" style={{ borderColor: accent }}>
            <h3 className="text-3xl font-bold uppercase" style={heading}>Your selected competitor</h3>
            <p className="mt-4 font-semibold">Who do buyers consider alongside you?</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">Choose one company that a customer would consider as a relevant alternative to your business, not simply the largest or most recognizable name in your industry.</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">This could be a company buyers mention in sales conversations or one competing for the same customers.</p>
            <p className="mt-3 text-sm font-semibold">Your analysis will compare your company with your primary competitor.</p>
            <div className="mt-7">
              <label htmlFor="profile-competitor-url" className="text-sm font-semibold">Competitor’s Website <span className="text-brand-red" aria-hidden="true">*</span></label>
              <input id="profile-competitor-url" name="competitorUrl" data-testid="input-url" type="text" inputMode="url" autoComplete="url" required maxLength={300} value={competitorUrl} onChange={e => onCompetitorUrlChange(e.target.value)} placeholder="Competitor website" aria-describedby="profile-competitor-help" className={inputClass} />
              <p id="profile-competitor-help" className="mt-3 text-xs leading-relaxed text-slate-500">Use the website buyers would visit to evaluate this company.</p>
            </div>
          </section>
        </div>
        <div className="mt-10 border-t-[3px] pt-5">
          <label htmlFor="report-email" className="text-sm font-semibold">Email for your report *</label>
          <input id="report-email" type="email" autoComplete="email" required maxLength={254} value={props.email || ""} onChange={e=>props.onEmailChange?.(e.target.value)} className={inputClass} placeholder="you@company.com" />
          <p className="mt-3 text-xs text-slate-500">{props.emailEnabled ? "We’ll use this address to deliver your requested analysis PDF." : "Email delivery is not active yet. You can view your analysis here, and the team can retrieve your saved PDF; it will not be emailed automatically later."}</p>
        </div>
        {error && <p role="alert" className="mt-8 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      </section>
      <section className="px-6 py-12 text-center text-white sm:px-10" style={{ background: navy }}>
        <h2 className="text-3xl font-bold uppercase sm:text-4xl" style={heading}>Ready to see how you compare?</h2>
        <p className="mt-5 text-sm leading-relaxed text-white/85">Check that both websites are correct.</p>
        <p className="mt-2 text-sm text-white/85">Then run your side-by-side comparison.</p>
        <button type="submit" data-testid="button-score" className="visibility-cta visibility-cta-on-dark mx-auto mt-7 w-full max-w-xs">Compare My Company <ArrowRight size={22} aria-hidden="true" /></button>
        <p className="mt-5 text-xs font-semibold">Your company. One competitor. The same scoring model, side by side.</p>
        <p className="mt-3 text-xs leading-relaxed text-white/70">Your personalized Competitive Presence Analysis is already included with your Masterclass purchase.</p>
      </section>
    </form>
    <section className="mx-auto grid max-w-6xl gap-7 px-6 py-12 sm:px-10 md:grid-cols-[1fr_2fr] md:gap-16 md:py-16">
      <div><h2 className="max-w-xs text-3xl font-bold uppercase leading-tight" style={heading}>What your scores mean</h2><div className="mt-5 h-1 w-10" style={{ background: accent }} /></div>
      <div className="space-y-4 text-sm leading-relaxed text-slate-600">
        <p>Your results compare what buyers can find and understand about your company and your selected competitor before speaking with sales. They reflect the public information available for review, not a rating of your product quality, your team’s expertise, or your sales performance.</p>
        <p>A lower score is a reason to look more closely at the public evidence. It is not proof that another company is better.</p>
        <p className="font-semibold" style={{ color: navy }}>The goal is not just a higher number. It is to see what buyers can learn before the call and what your team may still need to explain live.</p>
      </div>
    </section>
  </main>;
}

