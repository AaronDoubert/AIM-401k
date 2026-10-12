import { describe, expect, it } from "vitest";
import { classify, companyFromUrl, companyKey, domainLabel, fingerprint, guessCompany, isAtsEmail, type JobRef, looksJobRelated, matchJob, nextStatus, senderLabel } from "../src/core/intel";
import type { IntelKind, JobStatus, RawMail } from "../src/shared/types";

const mail = (subject: string, snippet = "", from = "", fromEmail = ""): RawMail => ({ messageId: "m", from, fromEmail, subject, snippet, receivedAt: 0 });
const kindOf = (subject: string, snippet = "", from = "", fromEmail = "") => classify(mail(subject, snippet, from, fromEmail)).kind;

describe("classify", () => {
  const cases: [IntelKind, string, string][] = [
    // received
    ["received", "Thank you for applying to Acme Robotics", "Hi Ada, we've received your application for Senior Platform Engineer and our team is reviewing it."],
    ["received", "Application received: Data Engineer", "This email confirms we received your application."],
    ["received", "We’ve received your application", "Thanks for your interest in Globex! Our recruiting team will review your profile."],
    ["received", "Ada, your application was sent to Initech", "Your application was sent to Initech. Backend Engineer · Initech · Remote"],
    ["received", "Thanks for your interest in Hooli", "We appreciate you taking the time to apply for the Site Reliability Engineer position."],
    ["received", "Your application to Pied Piper", "Thank you for your application! Next steps: our team will review it and if your experience is a match, a recruiter will reach out to schedule a call."],
    ["received", "Application confirmation - Requisition R-10432", "Thank you for submitting your application. Due to the high volume of applications, unfortunately we are unable to respond to every applicant individually."],
    // rejection
    ["rejection", "Your application to Hooli", "Thank you for your interest in Hooli. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs."],
    ["rejection", "Thank you for applying to Globex", "Thank you for applying… unfortunately, we won't be moving forward with your application at this time."],
    ["rejection", "Update on your application", "After careful consideration, we have decided not to proceed with your candidacy."],
    ["rejection", "Senior Engineer position", "We wanted to let you know that the position has been filled. We will keep your resume on file."],
    ["rejection", "Your candidacy at Stark Industries", "We regret to inform you that you were not selected for the next round."],
    ["rejection", "Thank you for interviewing with us", "It was great speaking with you. Unfortunately, the team has decided to go with another candidate for this role."],
    ["rejection", "Re: Backend Engineer", "Thanks for taking the time to chat with us. Unfortunately we will not be proceeding with your application."],
    ["rejection", "Application status", "Hi Ada, thank you for applying. Unfortunately, we are not able to offer you a position at this time."],
    // interview
    ["interview", "Next steps for your application", "Hi Ada, thanks for applying! We'd love to schedule a 30-minute phone screen. Please share your availability for next week."],
    ["interview", "Interview invitation – Massive Dynamic", "We'd like to invite you to a video interview with our research team. Book a time: https://calendly.com/md/interview"],
    ["interview", "Chat with Globex?", "Hi Ada, I'm a recruiter at Globex and would love to set up a call about the Data Engineer role."],
    ["interview", "Re: Technical interview availability", "Great, you're confirmed for Tuesday at 2pm ET. Your interview is scheduled with two engineers."],
    ["interview", "Scheduling your onsite interview", "Please pick a time using this GoodTime link: https://app.goodtime.io/schedule/abc"],
    ["interview", "Acme Robotics - next steps", "Unfortunately our hiring manager is out sick, so we need to reschedule your interview to Thursday."],
    ["interview", "Moving forward!", "Congrats, we'd like to move you forward to the next round of interviews for the Platform role."],
    // assessment
    ["assessment", "Tyrell Corporation: complete your coding challenge", "You have been invited to complete the HackerRank test for Backend Engineer."],
    ["assessment", "Next step: take-home exercise", "As the next step in our hiring process, please complete the take-home assignment within 5 days."],
    ["assessment", "Initech online assessment", "Please complete the CodeSignal General Coding Assessment for your application."],
    ["assessment", "Your Codility test for Acme", "Hi Ada, you have been invited to a Codility test."],
    // offer
    ["offer", "Offer letter — Cyberdyne Systems", "Ada, we are thrilled to extend you an offer to join Cyberdyne Systems as Staff Engineer."],
    ["offer", "Congratulations!", "We are pleased to offer you the position of Senior Platform Engineer at Acme Robotics."],
    ["offer", "Your offer from Globex", "Please review your offer letter and sign by Friday."],
    // other
    ["other", "Why your sourdough won't rise", "Stories for Ada: today's highlights from writers you follow."],
    ["other", "Your October points summary", "You earned 120 points this month. Redeem them for gift cards."],
    ["other", "Quick call next week?", "Hi Ada, I'd love to schedule a call to show you how our observability platform can cut your cloud bill."],
    ["other", "Your order has shipped", "Unfortunately, one item in your order is delayed."],
  ];
  for (const [kind, subject, snippet] of cases) {
    it(`${kind}: ${subject}`, () => expect(kindOf(subject, snippet)).toBe(kind));
  }

  it("ranks rejection above 'thank you for applying'", () => {
    const c = classify(mail("Thank you for applying to Acme", "Thank you for applying. Unfortunately, we have decided to pursue other candidates."));
    expect(c).toEqual({ kind: "rejection", confidence: 0.9 });
    expect(classify(mail("Thank you for applying to Acme", "Unfortunately, the role is no longer available.")).kind).toBe("rejection");
  });

  it("does not downgrade an offer to another candidate into an offer", () => {
    expect(kindOf("Update", "We have decided to extend an offer to another candidate for the role.")).toBe("rejection");
  });

  it("gives weak signals low confidence so AI can take a look", () => {
    expect(classify(mail("Next steps", "Hi Ada, about your application with us."))).toEqual({ kind: "interview", confidence: 0.5 });
    expect(classify(mail("Assessment", "About your application."))).toEqual({ kind: "assessment", confidence: 0.5 });
    expect(classify(mail("Hello", "Weekly digest"))).toEqual({ kind: "other", confidence: 0.1 });
  });

  it("trusts ATS senders and known companies as hiring mail", () => {
    expect(kindOf("Hi Ada", "Could we chat with you this week? Pick a time: calendly.com/x", "Acme", "no-reply@ashbyhq.com")).toBe("interview");
    expect(classify(mail("Hi Ada", "Could we chat this week? Pick a time that works."), { known: true }).kind).toBe("interview");
    expect(classify(mail("Hi Ada", "Could we chat this week? Pick a time that works.")).kind).toBe("other");
  });
});

describe("domains and names", () => {
  it("extracts registrable labels and ignores ATS / webmail senders", () => {
    expect(domainLabel("mail.careers.acme-robotics.com")).toBe("acme-robotics");
    expect(domainLabel("jobs.globex.co.uk")).toBe("globex");
    expect(senderLabel("no-reply@careers.hooli.com")).toBe("hooli");
    expect(senderLabel("no-reply@us.greenhouse-mail.io")).toBe("");
    expect(senderLabel("jane.recruiter@gmail.com")).toBe("");
    expect(isAtsEmail("acme@myworkday.com")).toBe(true);
    expect(isAtsEmail("no-reply@hire.lever.co")).toBe(true);
    expect(isAtsEmail("talent@acme.com")).toBe(false);
  });

  it("normalises company names", () => {
    expect(companyKey("Globex Corporation, Inc.")).toBe("globex");
    expect(companyKey("Acme Robotics")).toBe("acme robotics");
    expect(companyKey("Initech LLC")).toBe("initech");
    expect(companyKey("Labs")).toBe("labs");
  });

  it("reads the company slug from job URLs", () => {
    expect(companyFromUrl("https://job-boards.greenhouse.io/acmerobotics/jobs/123")).toBe("acmerobotics");
    expect(companyFromUrl("https://boards.greenhouse.io/embed/job_app?for=globex&token=1")).toBe("globex");
    expect(companyFromUrl("https://jobs.lever.co/hooli/abc-123/apply")).toBe("hooli");
    expect(companyFromUrl("https://jobs.ashbyhq.com/piedpiper/123")).toBe("piedpiper");
    expect(companyFromUrl("https://wayne.wd5.myworkdayjobs.com/en-US/External/job/X")).toBe("wayne");
    expect(companyFromUrl("https://careers-initech.icims.com/jobs/1/job")).toBe("initech");
    expect(companyFromUrl("https://careers.stark.com/jobs/42")).toBe("stark");
    expect(companyFromUrl("http://127.0.0.1:8080/posting.html")).toBe("");
    expect(companyFromUrl("https://www.linkedin.com/jobs/view/1")).toBe("");
  });

  it("guesses a display company for unmatched mail", () => {
    expect(guessCompany(mail("x", "", "Hooli Careers", "no-reply@careers.hooli.com"))).toBe("Hooli");
    expect(guessCompany(mail("x", "", "Massive Dynamic Talent", "talent@massivedynamic.com"))).toBe("Massive Dynamic");
    expect(guessCompany(mail("x", "", "Miles Dyson", "people@cyberdyne.io"))).toBe("Cyberdyne");
    expect(guessCompany(mail("Next steps", "", "Pied Piper", "no-reply@us.greenhouse-mail.io"))).toBe("Pied Piper");
    expect(guessCompany(mail("x", "", "Acme Robotics Recruiting via Greenhouse", "no-reply@greenhouse.io"))).toBe("Acme Robotics");
    expect(guessCompany(mail("x", "", "Jane from Globex", "jane@gmail.com"))).toBe("Globex");
    expect(guessCompany(mail("Ada, your application was sent to Stark Industries", "", "LinkedIn", "jobs-noreply@linkedin.com"))).toBe("Stark Industries");
  });
});

describe("matchJob", () => {
  const job = (id: string, company: string, title: string, url = `https://example.org/${id}`, status: JobStatus = "submitted"): JobRef => ({ id, company, title, url, status, appliedAt: status === "submitted" ? 1 : null });
  const jobs: JobRef[] = [
    job("acme", "Acme Robotics", "Senior Platform Engineer", "https://job-boards.greenhouse.io/acmerobotics/jobs/1"),
    job("globex", "Globex Corporation", "Data Engineer", "https://globex.wd5.myworkdayjobs.com/External/job/2"),
    job("initech", "Initech", "Backend Engineer", "https://jobs.lever.co/initech/3"),
    job("hooli", "", "", "https://careers.hooli.com/jobs/4"),
  ];

  it("matches by the sender's own domain", () => {
    expect(matchJob(mail("Your application", "Thanks!", "Careers", "no-reply@careers.acme-robotics.com"), jobs)).toMatchObject({ jobId: "acme", company: "Acme Robotics" });
    expect(matchJob(mail("Update", "", "Talent Team", "talent@initech.com"), jobs)?.jobId).toBe("initech");
  });

  it("uses the URL slug when the job has no company name", () => {
    expect(matchJob(mail("Your application", "", "Hooli Careers", "no-reply@careers.hooli.com"), jobs)).toMatchObject({ jobId: "hooli", company: "Hooli" });
  });

  it("matches ATS senders by display name, subject or snippet", () => {
    expect(matchJob(mail("Next steps", "Hi Ada", "Acme Robotics", "no-reply@us.greenhouse-mail.io"), jobs)?.jobId).toBe("acme");
    expect(matchJob(mail("Thank you for applying to Globex", "", "Recruiting", "globex@myworkday.com"), jobs)?.jobId).toBe("globex");
    expect(matchJob(mail("Your application", "Thanks for applying to Initech! We'll be in touch.", "Hiring Team", "no-reply@hire.lever.co"), jobs)?.jobId).toBe("initech");
    expect(matchJob(mail("Application update", "Hello", "Notifications", "no-reply@ashbyhq.com"), jobs)).toBeNull();
  });

  it("returns null when two jobs tie, and uses the title to break ties", () => {
    const two = [job("a1", "Acme Robotics", "Senior Platform Engineer"), job("a2", "Acme Robotics", "Data Scientist")];
    expect(matchJob(mail("Your application to Acme Robotics", "Thanks!"), two)).toBeNull();
    expect(matchJob(mail("Your application to Acme Robotics", "Thanks for applying for Data Scientist"), two)?.jobId).toBe("a2");
    expect(matchJob(mail("Acme Robotics: Senior Platform Engineer", ""), two)?.jobId).toBe("a1");
  });

  it("prefers the job that was actually applied to over an unsent draft", () => {
    const two = [job("draft", "Acme Robotics", "Senior Platform Engineer", "https://x.org/1", "ready_to_submit"), job("sent", "Acme Robotics", "Senior Platform Engineer", "https://x.org/2", "submitted")];
    expect(matchJob(mail("Acme Robotics - next steps", ""), two)?.jobId).toBe("sent");
  });

  it("never matches on unrelated mail or partial words", () => {
    expect(matchJob(mail("Your order has shipped", "Track your package", "Shop", "orders@shop.com"), jobs)).toBeNull();
    const meta = [job("meta", "Meta", "Engineer"), job("mb", "Metabase", "Engineer")];
    expect(matchJob(mail("Your Metabase application", "", "Metabase", "jobs@metabase.com"), meta)?.jobId).toBe("mb");
    expect(matchJob(mail("Metadata engineering newsletter", "", "News", "news@example.com"), meta)).toBeNull();
  });

  it("can use an AI-supplied company hint", () => {
    expect(matchJob(mail("Update on your application", "Hi Ada", "Jane Doe", "jane@gmail.com"), jobs, "Globex")?.jobId).toBe("globex");
  });

  it("feeds the AI pre-filter", () => {
    expect(looksJobRelated(mail("Hi", "quick question", "Acme Robotics", "x@us.greenhouse-mail.io"), jobs)).toBe(true);
    expect(looksJobRelated(mail("Sale ends today", "50% off", "Shop", "deals@shop.com"), jobs)).toBe(false);
  });
});

describe("nextStatus", () => {
  it("moves forward, never back", () => {
    expect(nextStatus("saved", "received")).toBe("submitted");
    expect(nextStatus("ready_to_submit", "received")).toBe("submitted");
    expect(nextStatus("submitted", "received")).toBeNull();
    expect(nextStatus("interviewing", "received")).toBeNull();
    expect(nextStatus("submitted", "interview")).toBe("interviewing");
    expect(nextStatus("submitted", "assessment")).toBe("interviewing");
    expect(nextStatus("interviewing", "interview")).toBeNull();
    expect(nextStatus("rejected", "interview")).toBeNull();
    expect(nextStatus("interviewing", "offer")).toBe("offer");
    expect(nextStatus("offer", "offer")).toBeNull();
    expect(nextStatus("interviewing", "rejection")).toBe("rejected");
    expect(nextStatus("rejected", "rejection")).toBeNull();
    expect(nextStatus("submitted", "other")).toBeNull();
  });
  it("never downgrades an offer", () => {
    for (const k of ["received", "interview", "assessment", "rejection", "other"] as IntelKind[]) expect(nextStatus("offer", k)).toBeNull();
  });
});

describe("fingerprint", () => {
  it("is the same for one email seen through the tab and the API", () => {
    const tab = mail("Next steps for your application", "Hi Ada, thanks for applying!  We'd love to schedule", "Acme", "no-reply@acme.com");
    const apiMail = mail("Next steps for your application", "Hi Ada, thanks for applying! We&#39;d love to schedule".replace("&#39;", "'"), "Acme Robotics", "No-Reply@acme.com");
    expect(fingerprint(tab)).toBe(fingerprint(apiMail));
  });
});
