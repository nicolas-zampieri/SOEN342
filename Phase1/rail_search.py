#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from typing import List, Optional, Dict, Tuple, Iterable, Set

# ----------------------------------
# Data model
# ----------------------------------

@dataclass(frozen=True)
class Route:
    route_id: str
    dep_city: str
    arr_city: str
    dep_time: time
    arr_time: time
    train_type: str
    days: Set[str]
    price_first: float
    price_second: float

    @property
    def duration_minutes(self) -> int:
        """Compute duration in minutes; if arrival < departure assume next-day arrival."""
        dt_dep = datetime.combine(datetime.today(), self.dep_time)
        dt_arr = datetime.combine(datetime.today(), self.arr_time)
        if dt_arr < dt_dep:
            dt_arr += timedelta(days=1)
        return int((dt_arr - dt_dep).total_seconds() // 60)

@dataclass
class Leg:
    route: Route

    @property
    def dep_city(self) -> str:
        return self.route.dep_city

    @property
    def arr_city(self) -> str:
        return self.route.arr_city

    @property
    def dep_time(self) -> time:
        return self.route.dep_time

    @property
    def arr_time(self) -> time:
        return self.route.arr_time

    @property
    def duration_minutes(self) -> int:
        return self.route.duration_minutes

@dataclass
class Itinerary:
    legs: List[Leg]
    transfers_minutes: List[int]  # time between legs in minutes (len = len(legs)-1)

    @property
    def dep_city(self) -> str:
        return self.legs[0].dep_city

    @property
    def arr_city(self) -> str:
        return self.legs[-1].arr_city

    @property
    def dep_time(self) -> time:
        return self.legs[0].dep_time

    @property
    def arr_time(self) -> time:
        return self.legs[-1].arr_time

    @property
    def duration_minutes(self) -> int:
        """Total journey time including transfers."""
        return sum(leg.duration_minutes for leg in self.legs) + sum(self.transfers_minutes)

    def price(self, cls: str) -> float:
        if cls.lower() == "first":
            return sum(leg.route.price_first for leg in self.legs)
        return sum(leg.route.price_second for leg in self.legs)

    @property
    def num_stops(self) -> int:
        return max(0, len(self.legs) - 1)

# ----------------------------------
# Parsing and Utilities
# ----------------------------------

DAY_ALIASES = {
    "mon": "Mon", "monday": "Mon",
    "tue": "Tue", "tuesday": "Tue",
    "wed": "Wed", "wednesday": "Wed",
    "thu": "Thu", "thursday": "Thu",
    "fri": "Fri", "friday": "Fri",
    "sat": "Sat", "saturday": "Sat",
    "sun": "Sun", "sunday": "Sun",
}

def parse_time(s: str) -> time:
    s = s.strip()
    for fmt in ("%H:%M", "%H.%M", "%H%M"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            pass
    raise ValueError(f"Unrecognized time format: {s!r}")

def parse_days(s: str) -> Set[str]:
    if not s:
        return set()
    parts = [p.strip() for p in s.replace("/", ",").split(",") if p.strip()]
    days = set()
    for p in parts:
        key = p.lower()
        key = "".join(ch for ch in key if ch.isalpha())
        days.add(DAY_ALIASES.get(key, p[:3].title()))
    return days

def load_routes(csv_path: str) -> List[Route]:
    routes: List[Route] = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Normalize field names to handle slight variations
        field_map = {k.lower().strip(): k for k in reader.fieldnames or []}
        get = lambda name: field_map.get(name.lower())

        for row in reader:
            try:
                route = Route(
                    route_id=str(row[get("Route ID")] or row[get("route_id")] or row[get("route id")]),
                    dep_city=str(row[get("Departure City")] or row[get("from")] or row[get("departure")]).strip(),
                    arr_city=str(row[get("Arrival City")] or row[get("to")] or row[get("arrival")]).strip(),
                    dep_time=parse_time(str(row[get("Departure Time")] or row[get("dep_time")] or row[get("departure time")] or row[get("depart")] )),
                    arr_time=parse_time(str(row[get("Arrival Time")] or row[get("arr_time")] or row[get("arrival time")] or row[get("arrive")] )),
                    train_type=str(row[get("Train Type")] or row[get("train")] or row[get("type")] ).strip(),
                    days=parse_days(str(row[get("Days of Operation")] or row[get("days")] or row[get("operation days")] )),
                    price_first=float(str(row[get("First Class ticket rate (in euro)")] or row[get("price_first")] or row[get("first class")] or 0).replace(",", ".").strip() or 0.0),
                    price_second=float(str(row[get("Second Class ticket rate (in euro)")] or row[get("price_second")] or row[get("second class")] or 0).replace(",", ".").strip() or 0.0),
                )
                routes.append(route)
            except Exception as e:
                print(f"[WARN] Skipping malformed row: {e}", file=sys.stderr)
    return routes

def minutes_between(t1: time, t2: time) -> int:
    """Return minutes from t1 to t2 assuming same day; if t2 < t1, wrap to next day."""
    d1 = datetime.combine(datetime.today(), t1)
    d2 = datetime.combine(datetime.today(), t2)
    if d2 < d1:
        d2 += timedelta(days=1)
    return int((d2 - d1).total_seconds() // 60)

def format_hhmm(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h:02d}:{m:02d}"

# ----------------------------------
# Searching
# ----------------------------------

def filter_routes(
    routes: Iterable[Route],
    dep_city: Optional[str] = None,
    arr_city: Optional[str] = None,
    train_type: Optional[str] = None,
    days: Optional[Iterable[str]] = None,
    dep_time_from: Optional[str] = None,
    dep_time_to: Optional[str] = None,
    arr_time_from: Optional[str] = None,
    arr_time_to: Optional[str] = None,
    max_price_first: Optional[float] = None,
    max_price_second: Optional[float] = None,
) -> List[Route]:
    """Return routes matching the given filters (case-insensitive where applicable)."""
    dep_city_norm = dep_city.lower() if dep_city else None
    arr_city_norm = arr_city.lower() if arr_city else None
    train_type_norm = train_type.lower() if train_type else None
    day_set = set(DAY_ALIASES.get(d.strip().lower(), d.strip().title()) for d in days) if days else None

    dtf = parse_time(dep_time_from) if dep_time_from else None
    dtt = parse_time(dep_time_to) if dep_time_to else None
    atf = parse_time(arr_time_from) if arr_time_from else None
    att = parse_time(arr_time_to) if arr_time_to else None

    out = []
    for r in routes:
        if dep_city_norm and dep_city_norm not in r.dep_city.lower():
            continue
        if arr_city_norm and arr_city_norm not in r.arr_city.lower():
            continue
        if train_type_norm and train_type_norm not in r.train_type.lower():
            continue
        if day_set and not (r.days & day_set):
            continue
        if dtf and minutes_between(dtf, r.dep_time) > (24 * 60 - 1):
            # if dep is not within same-day window start
            pass  # minutes_between always returns 0..(24h-1)
        if dtf and minutes_between(dtf, r.dep_time) < 0:
            continue  # unreachable due to above
        if dtf and dtt:
            # Check dep_time in [dtf, dtt] window (wrap-aware)
            dmin = minutes_between(dtf, r.dep_time)
            dmax = minutes_between(dtf, dtt)
            if dmax >= 0:
                if not (0 <= dmin <= dmax):
                    continue
            else:
                # wrapped range; allow if dmin >= 0 or dmin <= dmax (not needed given our minutes_between def)
                pass
        elif dtf and minutes_between(dtf, r.dep_time) < 0:
            continue

        if atf and att:
            amin = minutes_between(atf, r.arr_time)
            amax = minutes_between(atf, att)
            if amax >= 0:
                if not (0 <= amin <= amax):
                    continue

        if max_price_first is not None and r.price_first > max_price_first:
            continue
        if max_price_second is not None and r.price_second > max_price_second:
            continue
        out.append(r)
    return out

def find_direct_itineraries(
    routes: List[Route],
    dep_city: Optional[str],
    arr_city: Optional[str],
    **kwargs,
) -> List[Itinerary]:
    filtered = filter_routes(routes, dep_city=dep_city, arr_city=arr_city, **kwargs)
    return [Itinerary([Leg(r)], []) for r in filtered]

def routes_from_city(routes_by_dep: Dict[str, List[Route]], city: str) -> List[Route]:
    return routes_by_dep.get(city.lower(), [])

def find_connected_itineraries(
    routes: List[Route],
    dep_city: str,
    arr_city: str,
    max_stops: int = 2,
    min_transfer: int = 10,
    **kwargs,
) -> List[Itinerary]:
    """
    Find itineraries with up to `max_stops` (0=direct, 1=one stop, 2=two stops).
    Transfers must be >= min_transfer minutes. Overnight transfers are NOT considered.
    """
    # Pre-index by departure city for faster expansion
    routes_by_dep: Dict[str, List[Route]] = {}
    for r in filter_routes(routes, **kwargs):
        routes_by_dep.setdefault(r.dep_city.lower(), []).append(r)

    results: List[Itinerary] = []

    # Direct (0 stops)
    for r in routes_from_city(routes_by_dep, dep_city):
        if r.arr_city.lower() == arr_city.lower():
            results.append(Itinerary([Leg(r)], []))

    if max_stops >= 1:
        # One-stop: A -> X -> B
        for r1 in routes_from_city(routes_by_dep, dep_city):
            for r2 in routes_from_city(routes_by_dep, r1.arr_city):
                if r2.arr_city.lower() != arr_city.lower():
                    continue
                # transfer feasibility
                transfer = minutes_between(r1.arr_time, r2.dep_time)
                if transfer < min_transfer:
                    continue
                # simple same-day constraint: dep2 should not be "earlier" than dep1 in absolute clock sense if wrapped
                # Using a conservative check to avoid overnight complexities:
                if datetime.combine(datetime.today(), r2.dep_time) < datetime.combine(datetime.today(), r1.arr_time):
                    # If r2 departs before r1 arrives in same-day timeline (no wrap), we already handled via minutes_between
                    pass
                results.append(Itinerary([Leg(r1), Leg(r2)], [transfer]))

    if max_stops >= 2:
        # Two-stops: A -> X -> Y -> B
        for r1 in routes_from_city(routes_by_dep, dep_city):
            for r2 in routes_from_city(routes_by_dep, r1.arr_city):
                transfer1 = minutes_between(r1.arr_time, r2.dep_time)
                if transfer1 < min_transfer:
                    continue
                for r3 in routes_from_city(routes_by_dep, r2.arr_city):
                    if r3.arr_city.lower() != arr_city.lower():
                        continue
                    transfer2 = minutes_between(r2.arr_time, r3.dep_time)
                    if transfer2 < min_transfer:
                        continue
                    results.append(Itinerary([Leg(r1), Leg(r2), Leg(r3)], [transfer1, transfer2]))

    # Deduplicate itineraries by their sequence of route_ids (in case of duplicate rows)
    seen = set()
    deduped = []
    for it in results:
        key = tuple(leg.route.route_id for leg in it.legs)
        if key not in seen:
            seen.add(key)
            deduped.append(it)
    return deduped

# ----------------------------------
# High-level API
# ----------------------------------

def search_itineraries(
    csv_path: str,
    dep_city: Optional[str] = None,
    arr_city: Optional[str] = None,
    train_type: Optional[str] = None,
    days: Optional[Iterable[str]] = None,
    dep_time_from: Optional[str] = None,
    dep_time_to: Optional[str] = None,
    arr_time_from: Optional[str] = None,
    arr_time_to: Optional[str] = None,
    max_price_first: Optional[float] = None,
    max_price_second: Optional[float] = None,
    cls: str = "second",
    max_stops: int = 2,
    min_transfer: int = 10,
    sort_by: str = "duration",  # or "price"
    limit: Optional[int] = 50,
) -> List[Itinerary]:
    routes = load_routes(csv_path)
    kwargs = dict(
        train_type=train_type,
        days=days,
        dep_time_from=dep_time_from,
        dep_time_to=dep_time_to,
        arr_time_from=arr_time_from,
        arr_time_to=arr_time_to,
        max_price_first=max_price_first,
        max_price_second=max_price_second,
    )
    itineraries = find_connected_itineraries(
        routes,
        dep_city=dep_city or "",
        arr_city=arr_city or "",
        max_stops=max_stops,
        min_transfer=min_transfer,
        **kwargs,
    )

    if sort_by == "price":
        itineraries.sort(key=lambda it: (it.price(cls), it.duration_minutes))
    else:
        itineraries.sort(key=lambda it: (it.duration_minutes, it.price(cls)))

    if limit is not None:
        itineraries = itineraries[:limit]
    return itineraries

# ----------------------------------
# Presentation
# ----------------------------------

def itinerary_row(it: Itinerary, cls: str) -> Dict[str, str]:
    path = " → ".join([f"{leg.dep_city}({leg.dep_time.strftime('%H:%M')})" for leg in it.legs] + [f"{it.arr_city}({it.arr_time.strftime('%H:%M')})"])
    legs = " | ".join([
        f"[{i+1}] {leg.dep_city}→{leg.arr_city} {leg.dep_time.strftime('%H:%M')}-{leg.arr_time.strftime('%H:%M')} ({format_hhmm(leg.duration_minutes)})"
        for i, leg in enumerate(it.legs)
    ])
    transfers = ", ".join(f"{format_hhmm(m)}" for m in it.transfers_minutes) if it.transfers_minutes else "—"
    return {
        "Stops": str(it.num_stops),
        "Path": path,
        "Legs": legs,
        "Transfers": transfers,
        "Total Duration": format_hhmm(it.duration_minutes),
        "Total Price (First)": f"{it.price('first'):.2f}€",
        "Total Price (Second)": f"{it.price('second'):.2f}€",
        "Sort Price (Chosen Class)": f"{it.price(cls):.2f}€",
    }

def print_table(itineraries: List[Itinerary], cls: str) -> None:
    from shutil import get_terminal_size
    cols = ["Stops", "Total Duration", "Sort Price (Chosen Class)", "Transfers", "Path", "Legs"]
    rows = [itinerary_row(it, cls) for it in itineraries]

    # Compute column widths (limited by terminal width)
    term_width = max(100, get_terminal_size((120, 20)).columns)
    widths = {c: max(len(c), *(len(r[c]) for r in rows)) for c in cols}

    # Soft-wrap long columns to fit terminal (Path, Legs)
    def wrap(text: str, width: int) -> List[str]:
        if len(text) <= width:
            return [text]
        out, line = [], ""
        for part in text.split(" "):
            if len(line) + 1 + len(part) <= width:
                line = (line + " " + part).strip()
            else:
                out.append(line)
                line = part
        if line:
            out.append(line)
        return out

    # Adjust widths to fit
    fixed = sum(widths[c] + 3 for c in cols if c not in ("Path", "Legs"))
    avail = max(40, term_width - fixed - 3*2)
    path_w = min(widths["Path"], avail // 2)
    legs_w = max(20, avail - path_w)
    widths["Path"], widths["Legs"] = path_w, legs_w

    # Header
    hdr = " | ".join(c.ljust(widths[c]) for c in cols)
    sep = "-+-".join("-" * widths[c] for c in cols)
    print(hdr)
    print(sep)

    # Rows (with wrapping)
    for r in rows:
        path_lines = wrap(r["Path"], widths["Path"])
        legs_lines = wrap(r["Legs"], widths["Legs"])
        n = max(len(path_lines), len(legs_lines))
        for i in range(n):
            cells = [
                r["Stops"] if i == 0 else "",
                r["Total Duration"] if i == 0 else "",
                r["Sort Price (Chosen Class)"] if i == 0 else "",
                r["Transfers"] if i == 0 else "",
                path_lines[i] if i < len(path_lines) else "",
                legs_lines[i] if i < len(legs_lines) else "",
            ]
            print(" | ".join(cell.ljust(widths[c]) for cell, c in zip(cells, cols)))
        print(sep)

# ----------------------------------
# CLI
# ----------------------------------

def main(argv=None):
    p = argparse.ArgumentParser(description="Search EU rail connections (direct + up to 2 stops).")
    p.add_argument("--csv", required=True, help="Path to eu_rail_network.csv")
    p.add_argument("--from", dest="dep_city", help="Departure city (substring match)")
    p.add_argument("--to", dest="arr_city", help="Arrival city (substring match)")
    p.add_argument("--train-type", help="Filter by train type (substring match)")
    p.add_argument("--days", help="Comma-separated days to operate (e.g., Mon,Wed,Fri). Any overlap accepted.")
    p.add_argument("--dep-from", dest="dep_time_from", help="Earliest departure time (HH:MM)")
    p.add_argument("--dep-to", dest="dep_time_to", help="Latest departure time (HH:MM)")
    p.add_argument("--arr-from", dest="arr_time_from", help="Earliest arrival time (HH:MM)")
    p.add_argument("--arr-to", dest="arr_time_to", help="Latest arrival time (HH:MM)")
    p.add_argument("--max-price-first", type=float, help="Max first-class price for a single leg")
    p.add_argument("--max-price-second", type=float, help="Max second-class price for a single leg")
    p.add_argument("--class", dest="cls", default="second", choices=["first", "second"], help="Price class used for sorting")
    p.add_argument("--max-stops", type=int, default=2, choices=[0,1,2], help="Maximum number of stops (0=direct only)")
    p.add_argument("--min-transfer", type=int, default=10, help="Minimum transfer time in minutes")
    p.add_argument("--sort", dest="sort_by", default="duration", choices=["duration", "price"], help="Sort results by duration or price")
    p.add_argument("--limit", type=int, default=50, help="Limit number of results shown")

    args = p.parse_args(argv)

    days = [d.strip() for d in args.days.split(",")] if args.days else None

    itineraries = search_itineraries(
        csv_path=args.csv,
        dep_city=args.dep_city,
        arr_city=args.arr_city,
        train_type=args.train_type,
        days=days,
        dep_time_from=args.dep_time_from,
        dep_time_to=args.dep_time_to,
        arr_time_from=args.arr_time_from,
        arr_time_to=args.arr_time_to,
        max_price_first=args.max_price_first,
        max_price_second=args.max_price_second,
        cls=args.cls,
        max_stops=args.max_stops,
        min_transfer=args.min_transfer,
        sort_by=args.sort_by,
        limit=args.limit,
    )
    if not itineraries:
        print("No itineraries found for the given criteria.")
        return 0

    print_table(itineraries, args.cls)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
