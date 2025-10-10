# Use Cases — Iteration 1  

*SOEN 342 – Train Connection System*  

---

## UC-01 — Load Schedule Data  

**Primary Actor:** Client  
**Preconditions:**  

- CSV file exists and is well-formed  
- System is running  

**Postconditions:**  

- Train routes are stored in memory as objects  
- System is ready for searching  

**Main Success Scenario:**  

1. Client opens the application (or selects "Upload CSV")  
2. System reads the CSV and parses each row into route objects  
3. System validates fields and formats (times, prices)  
4. System indexes routes for efficient lookup  
5. System confirms data loaded successfully  

**Extensions:**  

- 2a. Malformed CSV → System rejects file and shows error message  
- 3a. Invalid time format → System skips that record and shows warning  

---

## UC-02 — Search for a Connection  

**Primary Actor:** Client  
**Preconditions:** UC-01 completed (data loaded)  

**Postconditions:**  

- Matches are displayed with all parameters + calculated trip duration  

**Search Parameters (any, except Route ID):**  

- Departure City  
- Arrival City  
- Departure Time window / Arrival Time window  
- Train Type  
- Days of Operation  
- First/Second-Class price range  

**Main Success Scenario:**  

1. Client enters search criteria  
2. System validates input (valid cities, time windows, etc.)  
3. System finds all direct matches  
4. System computes trip duration for each result  
5. System displays results with full details  
6. Client may sort or filter results (UC-03, UC-05)  

**Extensions:**  

- 3a. No direct connections → System calls UC-02a Construct Indirect Connections  
- 2a. Invalid criteria → Error message, return to step 1  

---

## UC-02a — Construct Indirect Connections (1–2 Stops)  

**Type:** Extension of UC-02  

**Primary Actor:** Client  

**Preconditions:** UC-01 completed and UC-02 found no (or not enough) direct matches  

**Postconditions:**  

- Valid itineraries with 1–2 stops are displayed, including transfer times  

**Main Success Scenario:**  

1. System finds candidate first-leg routes from Departure City to intermediate cities  
2. For each candidate, system finds compatible second-leg (and possibly third-leg) routes  
3. For each transfer, compute transfer time = next departure − previous arrival  
4. Discard itineraries with insufficient transfer time  
5. Compute total duration (first departure → final arrival) and total price  
6. Display feasible itineraries with segment details, transfer times, total duration and cost  

**Business Rules:**  

- BR-1: Minimum transfer time must be respected (e.g., 10 minutes)  
- BR-2: All segments must run on the chosen day of operation  

**Extensions:**  

- 4a. No feasible indirect itineraries → “No connections found” message  
- 5a. Overnight trips must handle date roll-over correctly  

---

## UC-03 — Sort Displayed Results  

**Primary Actor:** Client  

**Preconditions:** UC-02 or UC-02a has produced a result set  

**Postconditions:**  

- Results re-ordered according to selected parameter  

**Main Success Scenario:**  

1. Client selects sort option (Trip Duration, First-Class Price, Second-Class Price, Departure Time)  
2. System sorts results accordingly  
3. Results are re-rendered in new order  

**Extensions:**  

- 1a. Invalid sort key → Ignore and keep current order  
- 2a. Mixed results (direct and indirect) → Sort by computed total duration/total price  

---

## UC-04 — View Connection Details  

**Primary Actor:** Client  

**Preconditions:** A result set exists (from UC-02 or UC-02a)  

**Postconditions:**  

- Client sees full details of a selected connection  

**Main Success Scenario:**  

1. Client clicks/expands a result  
2. System displays:  
   - All parameters (departure/arrival, train type, days, prices)  
   - Computed trip duration (direct) OR total duration with transfer times (indirect)  
   - Price breakdown (per class, per leg if indirect)  
3. Client returns to results view  

**Extensions:**  

- 2a. For indirect itineraries → show each segment separately with times and cities  

---

## UC-05 — Filter Within Results (Optional)  

**Primary Actor:** Client  

**Preconditions:** A result set exists  

**Postconditions:**  

- Displayed results narrowed down without re-querying dataset  

**Main Success Scenario:**  

1. Client sets filter(s) (e.g., Train Type, price cap, departure window)  
2. System applies filter to the current results in memory  
3. System updates the list and shows active filters  

**Extensions:**  

- If filters exclude all results → Show “No results match these filters”  

---
