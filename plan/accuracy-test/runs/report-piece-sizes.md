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

## v097-s200 run 1 (tovira-extract-v0.9.7, pre-filter on, pieces of 200)
- AED 1.254 (batch price) · 7 pieces · thinking per piece 7166 (max 17625) · failed calls 0
- Recall 51/53 = 96% · by difficulty {"obvious":"17/17","moderate":"19/20","obscure":"15/16"}
- By field {"requirements":"15/16","promises":"9/9","people":"1/1","personal_facts":"8/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 7, wrong date 0, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); FAIL M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 1/2 dates
- Trap violations: N04
- Missed: X03, M19
- Items matching no key row: 13 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client traveling and unavailable for a period | in February | other | so we'll be away
  - key_dates: Handover date on another property | 05/06 | other | the handover on the other one was 05/06 apparently
  - requirements: A location that makes the school run easier for daughter starting KG2 | the school run is going to matter | 2026-06-25
  - concerns: Client reacted to a 5M price point by joking she'd have to 'rob a bank', suggesting it may be above budget
  - personal_facts: Sam Karimi | Daughter just started at university | family | my daughter just started at university too haha
  - personal_facts: Layla Haddad | Mentioned wanting to buy a villa in Spain someday | preference | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Karim | His mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Follow up on her colleague's interest in a 2-bed property
  - next_steps: Follow up with Layla and Karim, who said they'll probably decide by the end of the year but cautioned not to hold Karim to it
  - people: Layla Haddad | dentist with own clinic | unknown | Client searching for a home with her husband Karim | Hi Sam, Layla here. We're looking to buy, budget is 3.5M
  - people: Adam | unknown | Layla's son; plays football, has a tournament every Saturday | sorry was at Adam's football, he has a tournament every saturday
  - people: Rania | unknown | Sister of Layla; separately looking for a 1-bed near the Marina (referral) | my sister Rania is also looking for a 1 bed near the Marina btw

## v097-s200 run 2 (tovira-extract-v0.9.7, pre-filter on, pieces of 200)
- AED 1.282 (batch price) · 7 pieces · thinking per piece 7250 (max 12246) · failed calls 0
- Recall 53/53 = 100% · by difficulty {"obvious":"17/17","moderate":"20/20","obscure":"16/16"}
- By field {"requirements":"16/16","promises":"9/9","people":"1/1","personal_facts":"9/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); PASS M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 1/2 dates
- Trap violations: N04
- Missed: none
- Items matching no key row: 10 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Handover date mentioned for a previous property | 05/06 | other | the handover on the other one was 05/06 apparently
  - requirements: Property location that works for the school run | Noor starts KG2 in September so the school run is going to matter | 2026-06-25
  - personal_facts: Layla Haddad | Karim's mother will probably move in with them next year | family | Karim's mum will probably move in with us next year so we'd need a ground flo
  - personal_facts: Sam Karimi | Daughter just started university | family | my daughter just started at university too haha
  - personal_facts: Layla | Mentioned maybe buying a villa in Spain someday | preference | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | They bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Layla Haddad | Karim's mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Follow up with Karim, who may decide by the end of the year, though this is not a firm commitment
  - people: Layla Haddad | unknown | Primary contact communicating the family's property requirements | Hi Sam, Layla here. We're looking to buy, budget is 3.5M max, we can
  - people: Rania | unknown | Layla's sister; also looking for a 1-bed near the Marina (referral). | my sister Rania is also looking for a 1 bed near the Marina btw

## v097-s300 run 1 (tovira-extract-v0.9.7, pre-filter on, pieces of 300)
- AED 1.031 (batch price) · 5 pieces · thinking per piece 7780 (max 13785) · failed calls 0
- Recall 50/53 = 94% · by difficulty {"obvious":"16/17","moderate":"18/20","obscure":"16/16"}
- By field {"requirements":"14/16","promises":"9/9","people":"1/1","personal_facts":"8/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); FAIL M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 2/2 dates
- Trap violations: N02
- Missed: O01, M11, M19
- Items matching no key row: 9 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client traveling and will be unavailable | February | other | we're doing Umrah in February so we'll be away
  - key_dates: Handover date mentioned for a previous property | 05/06 | other | the handover on the other one was 05/06 apparently
  - requirements: Property near a suitable school for the school run | Noor starts KG2 in September so the school run is going to matter | 2026-06-25
  - concerns: Joked that a 5M budget would mean having to 'rob a bank', suggesting it may be a stretch
  - personal_facts: Layla Haddad | Mentioned wanting to one day buy a villa in Spain | preference | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Layla Haddad | Karim's mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Follow up on colleague's interest in a 2-bed apartment
  - next_steps: Karim may decide whether to proceed by the end of the year, but this is not a firm commitment

## v097-s300 run 2 (tovira-extract-v0.9.7, pre-filter on, pieces of 300)
- AED 1.167 (batch price) · 5 pieces · thinking per piece 9373 (max 16508) · failed calls 0
- Recall 52/53 = 98% · by difficulty {"obvious":"17/17","moderate":"19/20","obscure":"16/16"}
- By field {"requirements":"15/16","promises":"9/9","people":"1/1","personal_facts":"9/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); FAIL M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 1/2 dates
- Trap violations: none
- Missed: M19
- Items matching no key row: 11 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client will be traveling and unavailable | in February | other
  - key_dates: Handover date mentioned for a different property | 05/06 | other | the handover on the other one was 05/06 apparently
  - requirements: Location convenient for the school run (daughter starting KG2 in September) | the school run is going to matter | 2026-06-25
  - concerns: Said a 5M budget would mean she'd have to 'rob a bank', suggesting it's a financial stretch
  - personal_facts: Karim | His mother will probably move in with them next year | family | Karim's mum will probably move in with us next year
  - personal_facts: Layla | Mentioned wanting to buy a villa in Spain someday | other | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Layla | Karim's mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Follow up on Layla's colleague who is also looking for a 2-bed (referral)
  - next_steps: Karim expects to decide on the property by around the end of the year, though not firm
  - people: Layla Haddad | influencer | Main contact searching for the property; her husband must approve any purchase | Hi Sam, Layla here. We're looking to buy, budget is

## v097-s400 run 1 (tovira-extract-v0.9.7, pre-filter on, pieces of 400)
- AED 1.025 (batch price) · 4 pieces · thinking per piece 10019 (max 16344) · failed calls 0
- Recall 51/53 = 96% · by difficulty {"obvious":"17/17","moderate":"20/20","obscure":"14/16"}
- By field {"requirements":"15/16","promises":"9/9","people":"1/1","personal_facts":"8/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); PASS M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 2/2 dates
- Trap violations: none
- Missed: X03, X04
- Items matching no key row: 11 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Client will be traveling and unavailable during this period | February | other | in February so we'll be away
  - key_dates: Handover date reported for another (unrelated) property, mentioned as reference | 05/06 | other | the handover on the other one was 05/06 apparently
  - key_dates: Handover date mentioned for another property | 05/06 | other | the handover on the other one was 05/06 apparently
  - requirements: Property near a school, as her daughter starts KG2 in September | the school run is going to matter | 2026-06-25
  - concerns: ana ma abi shay fe mantiqa za7ma
  - personal_facts: Layla | Hopes to buy a villa in Spain someday | preference | maybe one day we'll buy a villa in Spain
  - personal_facts: Layla Haddad | Bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Karim | His mother is moving in with them | family | Karim's mum is definitely moving in now so we need 4 bedrooms not 3
  - next_steps: Follow up on Karim's tentative end-of-year decision timeline, which Layla indicated is not firm
  - people: Layla Haddad | Dentist (has her own clinic) | unknown | Coordinating the home search; her husband Karim must approve any purchase. | Hi Sam, Layla here. We're l
  - people: Rania | unknown | Layla's sister; separately searching for a 1-bed near the Marina | my sister Rania is also looking for a 1 bed near the Marina btw

## v097-s400 run 2 (tovira-extract-v0.9.7, pre-filter on, pieces of 400)
- AED 0.998 (batch price) · 4 pieces · thinking per piece 9586 (max 16421) · failed calls 0
- Recall 50/53 = 94% · by difficulty {"obvious":"17/17","moderate":"19/20","obscure":"14/16"}
- By field {"requirements":"14/16","promises":"9/9","people":"1/1","personal_facts":"8/9","concerns":"6/6","key_dates":"8/8","next_steps":"3/3","meeting":"1/1"}
- Dates (15 dated rows): correct 5, null as it should be 6, wrong date 1, null where a date was expected 3, item not stored 0
  - O11: null but a date was expected (stored null, expected 2026-06-30)
  - M07: wrong date (stored 2026-05-31, expected null)
  - M18: null but a date was expected (stored null, expected 2026-09-01)
  - X14: null but a date was expected (stored null, expected 2026-12-01)
- Updates: FAIL X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need); FAIL M19 updates O01 (the 3.8 stretch stored); PASS O18 is the meeting kept (12 Nov 16:00)
- X15 3/3 promises; X16 2/2 dates
- Trap violations: none
- Missed: X03, X04, M19
- Items matching no key row: 10 (quote not in chat: 0, timestamp not in chat: 0)
  - key_dates: Handover date mentioned for another property (ambiguous) | 05/06 | other | the handover on the other one was 05/06 apparently
  - key_dates: Handover date reported for another property the client mentioned | 05/06 | other | the handover on the other one was 05/06 apparently
  - requirements: Proximity to a school for the school run | the school run is going to matter | 2026-06-25
  - concerns: Frustrated with repeatedly being shown beige kitchens that don't match her taste
  - concerns: A 5M property is well beyond her budget (joked about needing to rob a bank to afford it)
  - personal_facts: Layla Haddad | Karim's mother may move in with them next year | family | Karim's mum will probably move in with us next year so we'd need a ground floor room fo
  - personal_facts: Layla Haddad | They bought their first flat in JVC back in 2019 | background | we bought our first flat in JVC back in 2019
  - personal_facts: Karim | His mother is moving in with them | family | Karim's mum is definitely moving in now
  - next_steps: Karim indicated they will probably decide by the end of the year, though this is not a firm commitment
  - people: Layla Haddad | unknown | Main client contact; purchase requires her husband Karim's approval | Hi Sam, Layla here

## v097: agreement between runs
- Found by both 52, by either 52: 100% agree
- Found by only one run: none

## v097-s200: agreement between runs
- Found by both 51, by either 53: 96% agree
- Found by only one run: X03, M19

## v097-s300: agreement between runs
- Found by both 50, by either 52: 96% agree
- Found by only one run: O01, M11

## v097-s400: agreement between runs
- Found by both 50, by either 51: 98% agree
- Found by only one run: M19

## Missed by every run
- none