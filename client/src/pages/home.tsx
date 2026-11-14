import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";

import { clearHandoff } from "@/lib/handoff";
import { CompetitiveProfile, ProcessingComparison } from "@/components/competitive-profile";
import { CompetitiveResults } from "@/components/competitive-results";
import type { ScoreResult } from "../../../server/analyze";

const REVIEW_URL = "https://buildyourbusiness.inspiredvibe.com/m-ca-booking";
type Result = ScoreResult & { scanId?: number | null };

/** Step 4 and 5 presentation. The existing scorer and stored scan format remain unchanged. */
export default function Home() {
  const [emailEnabled, setEmailEnabled] = useState(false);
  useEffect(() => { const controller = new AbortController();
    fetch(`${API_BASE}/api/report-capabilities`, {signal:controller.signal, cache:'no-store'})
      .then(r=>r.ok?r.json():null).then(data=>setEmailEnabled(data?.emailEnabled === true)).catch(()=>{});
    return ()=>controller.abort();
  }, []);
  const [email, setEmail] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const [ownUrl, setOwnUrl] = useState("");
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const submitted = useRef({ own: "", competitor: "" });
  const mutation = useMutation<
    { competitor: Result; own: Result | null; ownUnavailable: boolean; emailStatus: string }, Error,
    { own: string; competitor: string }
  >({
    mutationFn: async (values) => {
      const response = await fetch(`${API_BASE}/api/reports`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({...values, email, id: requestId.current}), signal: AbortSignal.timeout(295_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn’t complete your comparison. Please try again.");
      return data;
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError(null);
    mutation.reset();
    clearHandoff();
    if (!ownUrl.trim()) { setValidationError("Enter your company’s website to continue."); return; }
    if (!competitorUrl.trim()) { setValidationError("Enter your selected competitor’s website to continue."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setValidationError("Enter your email for report delivery."); return; }
    submitted.current = { own: ownUrl.trim(), competitor: competitorUrl.trim() };
    mutation.mutate(submitted.current);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const reset = () => {
    mutation.reset(); setValidationError(null); clearHandoff(); requestId.current = crypto.randomUUID();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (mutation.isPending) return <ProcessingComparison ownUrl={submitted.current.own} competitorUrl={submitted.current.competitor} />;
  if (mutation.data && !mutation.isError) return <>
    <p role="status" className="bg-brand-navy px-6 py-4 text-center text-white">{mutation.data.emailStatus === "accepted" ? "Your PDF has been accepted for email delivery. Check your inbox and spam folder." : "Your analysis is saved, but email delivery is not confirmed; the team can retrieve your PDF."}</p>
    <CompetitiveResults own={mutation.data.own} competitor={mutation.data.competitor}
      ownUrl={submitted.current.own} competitorUrl={submitted.current.competitor} reviewUrl={REVIEW_URL} />
    <div className="bg-brand-navy px-6 pb-8 text-center"><button type="button" onClick={reset}
      className="visibility-secondary-button">Compare another company</button></div>
  </>;
  return <CompetitiveProfile emailEnabled={emailEnabled} email={email} onEmailChange={setEmail} ownUrl={ownUrl} competitorUrl={competitorUrl}
    onOwnUrlChange={setOwnUrl} onCompetitorUrlChange={setCompetitorUrl}
    onSubmit={submit} isPending={false}
    error={validationError || (mutation.isError ? mutation.error.message : null)} />;
}

