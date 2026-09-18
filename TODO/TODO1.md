# TODO 1 — initial parent guides

The three static guides shown to the parent on turn 1 of a session, per topic. They are served from
`src/lib/staticData.ts` (inlined there; this file is the readable copy). Placeholders: `{child_name}`, `{subtopic}`.

## plan

| key | category | guide | example |
|---|---|---|---|
| plan-inform | specification | Explain the main event of the day. | Today we are visiting grandmother. |
| plan-todo | specification | Explain to-do of your child. | Do you know what to do today, {child_name}? |
| plan-expectation | intention | Ask your child what they expect to do. | What do you want to do today, {child_name}? |

## recall

| key | category | guide | example |
|---|---|---|---|
| recall-event | specification | Ask about an event of the day. | What did you do, {child_name}? |
| recall-memorable | specification | Ask about the most memorable thing of the day. | What was the most memorable thing, {child_name}? |
| recall-place | specification | Ask where {child_name} went to. | Did you go to any interesting place, {child_name}? |

## free

| key | category | guide | example |
|---|---|---|---|
| free-inform | specification | Raise what you are going to talk about. | What do you want to talk about? {subtopic}? |
| free-curiosity | encourage | Spice up the conversation. | Why don't we talk about something interesting? |
| free-specific | extend | Ask what specific things {child_name} wants to talk about {subtopic}. | What do you want to specifically talk about {subtopic}? |

## To do

- [ ] Review wording of the guides for the on-device board (they were written for the retired cloud child-turn flow).
