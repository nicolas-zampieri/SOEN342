# Use Cases — Iteration 1 (Simplified)

*SOEN 342 – Train Connection System*  

This document describes the three main use cases represented in the diagram.

---

## UC-01 — Load Schedule Data
**Primary Actor:** Client  

**Preconditions:**  
- The CSV file with train connections exists and is accessible.
- The CSV is properly formatted (as per specifications).
- The system is running.  

**Postconditions:**  
- Train routes are successfully parsed and stored in memory.  
- The system is ready for search queries.  

**Main Success Scenario:**  
1. Client opens the application or selects **Upload CSV**.  
2. System reads the CSV and parses each record.  
3. System validates fields (cities, times, prices).  
4. System confirms data is loaded and ready.  

**Extensions:**  
- CSV is invalid → System rejects file and shows error message.  

---

## UC-02 — Search for a Connection
**Primary Actor:** Client  

**Preconditions:**  
- UC-01 completed (data has been loaded into memory).  

**Postconditions:**  
- System displays all matching routes, with trip duration calculated.  

**Parameters (any, except Route ID):**  
- Departure City, Arrival City  
- Departure/Arrival Time window  
- Train Type  
- Days of Operation  
- First-/Second-Class price range  

**Main Success Scenario:**  
1. Client enters search criteria.  
2. System validates input (valid cities, valid time windows).  
3. System finds matching direct connections.  
4. System computes trip duration.  
5. Results are passed to UC-03 for display.  

**Extensions:**  
- No direct connections found → System may attempt to build indirect (1–2 stop) connections.  
- Invalid input → System shows error and asks client to re-enter criteria.  

---

## UC-03 — Displayed Results
**Primary Actor:** Client  

**Preconditions:**  
- UC-02 completed (results have been generated).  

**Postconditions:**  
- Results are displayed with all relevant information.  
- Client can interpret and use results for decision-making.  

**Main Success Scenario:**  
1. System displays each result with:  
   - Departure and arrival cities  
   - Departure and arrival times  
   - Train type  
   - Days of operation  
   - Ticket prices (first and second class)  
   - Computed trip duration  
2. Client views the results.  
3. Client may sort results (by duration, price, etc.) or select details.  

**Extensions:**  
- No results → System displays “No connections found.”  
- Mixed results (direct + indirect) → Show transfer times and total trip duration.  

---
