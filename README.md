# SOEN342

SOEN 342 group project 2025

Members:

    Team lead: Nicolas Zampieri 40275624

    Luca Ieraci 40276520

    Marc Fadous 40276612

Iteration I:

Loads train routes from a CSV file and lets you search for direct and
indirect connections (up to 2 stops). Supports filtering by most fields
(except route ID), computes trip + transfer durations, and sorts results
by duration or price.

Usage (CLI):
    python rail_search.py --csv eu_rail_network.csv \
        --from "Paris" --to "Berlin" \
        --class second --max-stops 2 --min-transfer 10 \
        --days "Mon,Tue,Wed,Thu,Fri" \
        --sort duration --limit 10

    # More examples
    python rail_search.py --csv eu_rail_network.csv --from "Rome" --to "Milan" --sort price
    python rail_search.py --csv eu_rail_network.csv --train-type "TGV" --from "Lyon" --to "Paris"
    python rail_search.py --csv eu_rail_network.csv --from "Munich" --to "Zurich" --class first --max-stops 1

Notes & Assumptions:

- Times are interpreted as HH:MM (24h). If arrival < departure, we assume arrival is next day.
- For multi-leg journeys (connections), we require that each next leg departs on the SAME DAY
  as the previous leg's arrival and at least min_transfer minutes after arrival.
  (Overnight transfers are NOT considered in this version.)
- "Days of Operation" is matched as overlapping sets (e.g., 'Mon,Wed,Fri'). When searching on
  days, we require that the chosen day appears in ALL legs. If you supply multiple days as a list,
  any overlap is accepted (at least one day common across all legs).
- Sorting by price uses your chosen class (first or second) aggregated across legs.
- This file offers both a CLI and a Python API (see search_itineraries).
