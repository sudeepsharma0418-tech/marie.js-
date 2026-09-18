---
name: apollo-lead-list-builder
description: Builds a fresh outbound lead list for the cleaning business by reading ICP.md, pulling matching companies and decision-maker contacts from Apollo, scoring each one against the ICP, filtering out exclusions, and writing the results into the running "Outbound Lead List (Apollo)" Google Sheet sorted by fit score. Use this whenever the user runs /apollo-lead-list-builder, or asks for a new batch of leads, prospects, or an updated lead list for outbound.
---

# Apollo Lead List Builder

This skill repeats, on demand, the lead-generation workflow already worked out with the
user: read the ICP, ask Apollo for matching companies and people, score and filter them,
and drop the results into one running spreadsheet. The point of packaging it as a skill
is that the user should never have to re-explain their targeting criteria — everything
about who to target lives in `ICP.md`, and this skill just re-reads it fresh every time
it runs. If the user edits `ICP.md` (new cities, a raised size threshold, a new
exclusion), the very next run picks that up automatically with no other changes needed.

Default batch size is **250 leads per run**. If the user asks for a different amount on a
given run, honor that instead.

## Step 1: Read ICP.md

Read `ICP.md` from the repository root. It contains, at minimum: target industries /
property types, services offered, geographic area, size thresholds, target decision-maker
titles, buying signals, exclusions, target deal size, and the desired lead data fields.
Treat this file as the single source of truth — don't ask the user to repeat any of it,
and don't fall back on assumptions from a previous run if the file has changed.

## Step 2: Find matching leads in Apollo

ICP.md describes a persona (property types like "luxury apartment complex" or "dental
clinic," decision-maker titles like "facilities manager"), not a literal set of Apollo
filter values. Because of that, use `apollo_agent_find_prospects` rather than the raw
search tools (`apollo_mixed_companies_search` / `apollo_mixed_people_api_search`) — those
raw tools explicitly require an exact, pre-resolved filter set and will silently miss
the point of a persona-style ask. `apollo_agent_find_prospects` is built to translate a
plain-language targeting description into the right Apollo filters, and it can chain a
company search into a people-at-those-companies search in one task, which a persona like
this one needs.

Pass the ICP content itself as the instruction (plus the requested batch size and any
exclusions), rather than inventing your own paraphrase of it — the whole point of routing
to this tool is to hand it the user's real targeting criteria and let it do the filter
translation, not to have you pre-guess NAICS codes or keyword tags yourself. A shape like
this works well:

```
Find up to 250 companies and their property/facilities/office manager contacts
that match this ideal customer profile for a commercial cleaning company:

Industries / property types: <copy from ICP.md>
Services we offer: <copy from ICP.md>
Geographic area: <copy from ICP.md>
Size thresholds: <copy from ICP.md>
Target decision-maker titles: <copy from ICP.md>
Buying signals that make a lead more interesting: <copy from ICP.md>
Do not include: <copy the exclusions from ICP.md>
```

The task is asynchronous — you'll get back a `task_id`. Poll it (passing `task_id` and no
`instruction`) until it's no longer in progress. If it comes back `awaiting_input`, answer
its question using information already in ICP.md where possible; only surface it to the
user if ICP.md genuinely doesn't cover it (e.g. it asks something ICP.md has no opinion
on).

Run one property type / vertical per task — never blend multiple verticals (e.g.
apartments and wineries and law offices) into a single search instruction. A mixed
instruction pushes Apollo's agent toward a vague, lowest-common-denominator query, and it
makes the results much harder to review and score meaningfully. Instead, work through
ICP.md's industry list one at a time: create a task for the first vertical, let it finish,
score and file those results (Steps 3–6), then move to the next vertical with a fresh
task. Split the run's total lead target evenly across the verticals being covered that
run, unless the user asks to focus on just one or weight them differently.

## Step 2a: Only keep contacts with a verified email and phone number

A lead is only useful for outbound if you can actually reach the person, so filter out
any contact whose email isn't verified or who has no phone number on file. Check each
result's email status field before including it, and if a contact needs the standard
phone reveal to get a number, run it — that endpoint doesn't need per-call confirmation
(unlike the enrichment/job-postings endpoints called out below), but if it turns out
several dozen reveals are needed in one run, mention the total to the user rather than
running them silently.

## Step 3: Score each lead against the ICP

Score every lead 0–100. There's no need for a rigid formula — the point is a fair,
explainable estimate of fit, not a precise number. A reasonable starting breakdown:

- **Industry / property type match (0–30):** exact match to a listed type scores highest;
  an adjacent or unclear fit scores lower.
- **Size fit (0–20):** meets or comfortably exceeds the ICP's size threshold.
- **Location fit (0–15):** inside the named metro area.
- **Title fit (0–20):** the contact holds one of the target decision-maker titles, or a
  clear equivalent (e.g. "Director of Facilities" for "facilities manager").
- **Buying signal present (0–15):** Apollo data suggests a signal from ICP.md — recent
  job postings (expansion/turnover hiring), headcount growth, a new funding round, or
  similar. Absence of a detectable signal isn't a penalty, it's just 0 in this bucket —
  most good-fit leads won't have one visible in Apollo data at any given moment.

Record a short plain-language note for each lead explaining the score (e.g. "100+ unit
apartment complex in Oakland, reached the facilities manager directly, company posted 3
maintenance job openings last month").

## Step 4: Apply exclusions

Drop anything ICP.md's exclusions section rules out — small offices below the size
threshold, companies that look like existing customers, and very large/slow-moving
companies (e.g. Google, Apple) unless the user has said otherwise. For existing customers,
check the lead's company against the team's saved Apollo accounts (the `accounts` bucket
returned by a companies search, or `apollo_deals_search`) — if it's already a saved
account or has a closed-won deal, treat it as an existing customer and drop it, since the
user can't hand you a full name list to check against manually.

## Step 5: Dedupe against the running sheet

The output lives in one continuously-updated Google Sheet rather than a new file every
run, so before writing anything, find it:

```
search_files: title contains 'Outbound Lead List' and mimeType = 'application/vnd.google-apps.spreadsheet'
```

If it exists, read it with `read_file_content` to get the current rows. Skip any new lead
whose email (or, lacking an email, company + contact name) already appears — the point of
one running sheet is to accumulate leads over time without re-listing ones already sent
out, not to overwrite history.

Note on the mechanics: the Google Drive connector available here can create or fully
replace a file's content, but it has no cell-level "append a row" operation. So "append"
in practice means: merge the existing rows with the new ones in memory, then replace the
file's contents with the combined, deduped, re-sorted set. From the user's point of view
it's still one running sheet at a stable name — the replace-in-place is just how it's
implemented under the hood.

## Step 6: Write the results

Build a CSV with these columns, matching ICP.md's "Lead List Data Points" section plus
the score:

```
Company, Address, Contact Name, Title, Email, Phone, Signal, Fit Score, Notes
```

Sort by Fit Score descending. If a matching sheet was found in Step 5, trash it
(`trash_file`) and create a new file with the same title in the same parent folder,
using `create_file` with `contentMimeType: text/csv` and the combined CSV as
`textContent` (Google Drive will convert it into a proper Sheet automatically). If no
sheet existed yet, just create it fresh with title `Outbound Lead List (Apollo)`.

## Step 7: Tell the user what happened

Report, briefly: how many new leads were added, how many were skipped as duplicates or
exclusions, the score range, and a link to the sheet. Mention anything that seemed off —
for example, if ICP.md was missing a section this run needed, or if Apollo's agent asked
a clarifying question you had to answer on the user's behalf.

## A note on Apollo credits

`apollo_agent_find_prospects` and standard people/company search don't require
per-call credit confirmation, but company enrichment (`apollo_organizations_enrich`) and
job postings lookups (`apollo_organizations_job_postings`) each cost 1 credit per call and
Apollo's own tool rules require confirming the cost with the user first. Avoid reaching
for those unless the agent's results are missing something you need — and if a run would
need many of them (e.g. checking job postings for dozens of companies to detect buying
signals), confirm the total credit cost with the user upfront in one message rather than
one confirmation per company.
