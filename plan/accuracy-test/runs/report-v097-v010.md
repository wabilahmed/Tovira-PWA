## v097 run 1 (tovira-extract-v0.9.7, pre-filter on, pieces of 120)
- AED 1.566 (batch price) · 13 pieces · thinking per piece 4447 (max 8183) · failed calls 0
- Recall 52/53 = 98% · by difficulty {"obvious":"17/17","moderate":"19/20","obscure":"16/16"}
- By field {"requirements":"15/16","promises":"9/9","people":"1/1","personal_facts":"9/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); FAIL M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 2/2 dates
- Trap violations: none
- Missed: M19
- Items matching no key row: 13 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client will be away traveling in February | February | other
  - key_dates: Handover date on another property | 05/06 | other | the handover on the other one was 05/06 apparently
  - key_dates: Expected decision timing on the deal (uncertain) | by the end of the year | deadline | Karim says we'll probably decide by the end of the year, but don't hold h
  - requirements: A property location where the school run is manageable, given Noor starts KG2 in September | Noor starts KG2 in September so the school run is going to matter |
  - concerns: Feels a 5M budget is out of reach, joked she'd have to rob a bank to afford it
  - personal_facts: Layla Haddad | Mentioned maybe one day buying a villa in Spain | other | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Layla Haddad | Karim's mother is moving in with them | family | Karim's mum is definitely moving in now
  - personal_facts: Karim | His mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Follow up on colleague's interest in a 2-bed property
  - next_steps: Possible decision from Karim and Layla by end of year, though they said not to count on it
  - people: Layla Haddad | Dentist | influencer | Needs her husband Karim's approval before any purchase | Hi Sam, Layla here. We're looking to buy, budget is 3.5M max, we 
  - people: Rania | sister | unknown | Referral - also looking for a 1 bed near the Marina | my sister Rania is also looking for a 1 bed near the Marina btw

## v097 run 2 (tovira-extract-v0.9.7, pre-filter on, pieces of 120)
- AED 1.444 (batch price) · 13 pieces · thinking per piece 4302 (max 10255) · failed calls 0
- Recall 52/53 = 98% · by difficulty {"obvious":"17/17","moderate":"19/20","obscure":"16/16"}
- By field {"requirements":"15/16","promises":"9/9","people":"1/1","personal_facts":"9/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); FAIL M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 2/2 dates
- Trap violations: none
- Missed: M19
- Items matching no key row: 11 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client will be away traveling in February | in February | other
  - key_dates: Handover date mentioned for another property | 05/06 | other | the handover on the other one was 05/06 apparently
  - key_dates: Karim's expected decision on the deal (uncertain, per Layla) | 2026-12-31 | end of the year | deadline | Karim says we'll probably decide by the end of the year
  - concerns: Joked that a 5M budget would mean she'd 'have to rob a bank'
  - personal_facts: Layla Haddad | Her mother-in-law may move in with them next year | family | Karim's mum will probably move in with us next year so we'd need a ground floor room
  - personal_facts: Layla Haddad | Said maybe one day they'll buy a villa in Spain | other | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Karim | His mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Karim may decide on the purchase by the end of the year, but this is not firm
  - people: Layla Haddad | Dentist, owns her own clinic | unknown | Hi Sam, Layla here. We're looking to buy, budget is 3.5M max, we can't go above that
  - people: Rania | Layla's sister | unknown | Looking for a 1-bed near the Marina (referral, not Layla's own need) | my sister Rania is also looking for a 1 bed near the M

## v010 run 1 (tovira-extract-v0.10-draft, pre-filter on, pieces of 120)
- AED 0.99 (batch price) · 13 pieces · thinking per piece 2340 (max 4548) · failed calls 0
- Recall 53/53 = 100% · by difficulty {"obvious":"17/17","moderate":"20/20","obscure":"16/16"}
- By field {"budget":"2/2","requirements":"14/14","promises":"9/9","decision_process":"2/2","personal_facts":"8/8","concerns":"5/5","key_dates":"8/8","next_steps":"3/3","situation":"1/1","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); PASS M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 2/2 dates
- Trap violations: N09
- Missed: none
- Items matching no key row: 15 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Will be away for personal travel in February | February | other
  - key_dates: Client will be away traveling | February | other
  - budget: 5M | sure, 5M, why not, I'll just rob a bank 😂
  - decision_process: the bank | Approval needed before they sign | if the bank approves by end of month we'll sign
  - decision_process: the bank | Approves (loan/mortgage) before they sign | if the bank approves by end of month we'll sign
  - decision_process: Karim | Can approve stretching the budget to 3.8 if it's perfect | Karim said we can stretch to 3.8 if it's perfect
  - decision_process: Karim | Whether to proceed, probably by the end of the year (not firm) | Karim says we'll probably decide by the end of the year, but don't hold him to it
  - personal_facts: Layla | Maybe one day they'll buy a villa in Spain | preference | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Layla Haddad | Karim's mum is moving in with them | family | Karim's mum is definitely moving in now so we need 4 bedrooms not 3
  - next_steps: Karim says they'll probably decide by the end of the year, but not to hold him to it
  - people: Layla Haddad | unknown | Hi Sam, Layla here. We're looking to buy, budget is 3.5M max, we can't go above that
  - people: Adam | unknown | Has a football tournament every Saturday | Adam's football, he has a tournament every saturday
  - people: Rania | unknown | Layla's sister, also looking for a 1-bed near the Marina | my sister Rania is also looking for a 1 bed near the Marina btw
  - people: Noor | unknown | Starts KG2 in September | Noor starts KG2 in September so the school run is going to matter

## v010 run 2 (tovira-extract-v0.10-draft, pre-filter on, pieces of 120)
- AED 1.125 (batch price) · 13 pieces · thinking per piece 2491 (max 5453) · failed calls 0
- Recall 53/53 = 100% · by difficulty {"obvious":"17/17","moderate":"20/20","obscure":"16/16"}
- By field {"budget":"2/2","requirements":"14/14","promises":"9/9","decision_process":"2/2","personal_facts":"8/8","concerns":"5/5","key_dates":"8/8","next_steps":"3/3","situation":"1/1","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); PASS M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 0/2 dates
- Trap violations: none
- Missed: none
- Items matching no key row: 16 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client will be away | February | other | we'll be away
  - key_dates: Karim's expected decision on the deal | the end of the year | deadline | we'll probably decide by the end of the year
  - decision_process: the bank | Must approve before they sign | if the bank approves by end of month we'll sign
  - decision_process: the bank | Approves financing before they sign | if the bank approves by end of month we'll sign
  - decision_process: Karim | Can stretch the budget to 3.8 if it's perfect | Karim said we can stretch to 3.8 if it's perfect
  - decision_process: Karim | Whether to proceed, probably by the end of the year | Karim says we'll probably decide by the end of the year, but don't hold him to it
  - concerns: Reacted sarcastically to a 5M price point, joking she'd have to rob a bank to afford it
  - personal_facts: Layla | Mentioned maybe buying a villa in Spain one day | other | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Karim's mum | Is definitely moving in with them now | family | Karim's mum is definitely moving in now
  - next_steps: Follow up on her colleague's interest in a 2-bed
  - next_steps: Karim expects they may decide by the end of the year, though this is not a firm commitment
  - next_steps: Follow up on Karim's decision, expected around the end of the year
  - people: Layla Haddad | unknown | Hi Sam, Layla here. We're looking to buy, budget is 3.5M max, we can't go above that
  - people: Adam | unknown | Has a football tournament every Saturday | was at Adam's football, he has a tournament every saturday
  - people: Rania | sister | unknown | Looking for a 1-bed near the Marina | my sister Rania is also looking for a 1 bed near the Marina btw

## v097: agreement between runs
- Found by both 52, by either 52: 100% agree
- Found by only one run: none

## v010: agreement between runs
- Found by both 53, by either 53: 100% agree
- Found by only one run: none

## Missed by every run
- none