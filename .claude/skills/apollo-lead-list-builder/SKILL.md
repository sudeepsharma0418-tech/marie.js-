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
