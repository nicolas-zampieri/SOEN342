// main-2.js — Iteration 3 (backend-connected, OO domain model)
//
// Assumes:
// - Flask server running at http://127.0.0.1:5000
// - Endpoints:
//    GET  /api/routes              -> list of routes from DB (optional but preferred)
//    POST /api/trips               -> book a trip, returns { trip_id }
//    GET  /api/trips?last_name=&gov_id= -> upcoming/history trips for passenger
//
// Also supports CSV upload as a fallback to populate `routes` on the client.

(() => {
  const API_BASE = "http://127.0.0.1:5000/api";

  const $ = (id) => document.getElementById(id);

  // ---------------- Domain helpers ----------------

  class TimeUtils {
    static parseTimeToMin(str) {
      if (!str) return null;
      const parts = str.trim().split(":");
      if (parts.length !== 2) return null;
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    }

    static minToHHMM(mins) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  class DayUtils {
    static getDayAbbrevFromDateStr(ymd) {
      const [y, mo, d] = ymd.split("-").map(Number);
      const dt = new Date(y, mo - 1, d);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return days[dt.getDay()];
    }

    static parseDaysOfOperation(str) {
      if (!str) return [];
      return str
        .split(/[,/ ]+/)
        .map((d) => d.trim().slice(0, 3))
        .filter(Boolean)
        .map((d) => d[0].toUpperCase() + d.slice(1).toLowerCase()); // Mon, Tue...
    }
  }

  class TimeOfDay {
    constructor(minutes) {
      this.minutes = minutes;
      this.h = Math.floor(minutes / 60);
      this.m = minutes % 60;
    }

    static fromString(str) {
      const mins = TimeUtils.parseTimeToMin(str);
      if (mins == null) return null;
      return new TimeOfDay(mins);
    }

    toString() {
      return TimeUtils.minToHHMM(this.minutes);
    }
  }

  // ---------------- Domain entities ----------------

  class Route {
    constructor({
      routeId,
      dep_city,
      arr_city,
      dep_time,
      arr_time,
      train_type = "",
      days = [],
      daysStr = "",
      price_first = null,
      price_second = null
    }) {
      this.route_id = routeId;
      this.dep_city = dep_city;
      this.arr_city = arr_city;
      this.dep_time = dep_time;
      this.arr_time = arr_time;
      this.train_type = train_type;
      this.days = days;
      this.daysStr = daysStr;
      this.price_first = isNaN(price_first) ? null : price_first;
      this.price_second = isNaN(price_second) ? null : price_second;
      this.duration = this.arr_time.minutes - this.dep_time.minutes;
    }

    static parsePrice(val) {
      if (val === null || val === undefined || val === "") return null;
      const num = Number(val);
      return Number.isNaN(num) ? null : num;
    }

    static fromBackend(row) {
      const depTime = TimeOfDay.fromString(row.departure_time);
      const arrTime = TimeOfDay.fromString(row.arrival_time);
      if (!depTime || !arrTime) return null;

      const daysStr = row.days_of_op || "";
      return new Route({
        routeId: String(row.route_id || row.id),
        dep_city: String(row.departure_city),
        arr_city: String(row.arrival_city),
        dep_time: depTime,
        arr_time: arrTime,
        train_type: row.train_type || "",
        days: DayUtils.parseDaysOfOperation(daysStr),
        daysStr,
        price_first: Route.parsePrice(
          row.first_class ?? row.price_first_class
        ),
        price_second: Route.parsePrice(
          row.second_class ?? row.price_second_class
        )
      });
    }

    static fromCsv(row) {
      const id =
        HeaderNormalizer.pick(row, [
          "Route ID",
          "route_id",
          "id",
          0
        ]) || "";
      const from = HeaderNormalizer.pick(row, [
        "Departure City",
        "From"
      ]);
      const to = HeaderNormalizer.pick(row, ["Arrival City", "To"]);
      const dep = HeaderNormalizer.pick(row, [
        "Departure Time",
        "Dep"
      ]);
      const arr = HeaderNormalizer.pick(row, ["Arrival Time", "Arr"]);
      if (!id || !from || !to || !dep || !arr) return null;

      const depTime = TimeOfDay.fromString(dep);
      const arrTime = TimeOfDay.fromString(arr);
      if (!depTime || !arrTime) return null;

      const daysStr =
        HeaderNormalizer.pick(row, ["Days of Operation", "Days"]) || "";

      return new Route({
        routeId: id.toString(),
        dep_city: from.toString().trim(),
        arr_city: to.toString().trim(),
        dep_time: depTime,
        arr_time: arrTime,
        train_type:
          HeaderNormalizer.pick(row, ["Train Type", "Type"]) || "",
        days: DayUtils.parseDaysOfOperation(daysStr),
        daysStr,
        price_first: Route.parsePrice(
          HeaderNormalizer.pick(row, [
            "First Class ticket rate (in euro)",
            "First Class",
            "1st"
          ])
        ),
        price_second: Route.parsePrice(
          HeaderNormalizer.pick(row, [
            "Second Class ticket rate (in euro)",
            "Second Class",
            "2nd"
          ])
        )
      });
    }

    matchesDay(dayFilterArr) {
      if (!dayFilterArr.length) return true;
      if (!this.days.length) return true;
      return dayFilterArr.some((d) => this.days.includes(d));
    }

    matchesQuery(query) {
      if (
        query.train_type &&
        this.train_type &&
        !this.train_type
          .toLowerCase()
          .includes(query.train_type.toLowerCase())
      ) {
        return false;
      }
      if (
        query.dep_from != null &&
        this.dep_time.minutes < query.dep_from
      )
        return false;
      if (query.dep_to != null && this.dep_time.minutes > query.dep_to)
        return false;
      if (
        query.max_price_first != null &&
        this.price_first != null &&
        this.price_first > query.max_price_first
      )
        return false;
      if (
        query.max_price_second != null &&
        this.price_second != null &&
        this.price_second > query.max_price_second
      )
        return false;
      return true;
    }

    priceForClass(classType) {
      if (classType === "first") {
        return this.price_first != null ? this.price_first : Infinity;
      }
      return this.price_second != null ? this.price_second : Infinity;
    }
  }

  class Itinerary {
    constructor({ legs, chosenClass, transfers }) {
      this.legs = legs;
      this.chosenClass = chosenClass;
      this.transfers = transfers || [];
    }

    get stops() {
      return Math.max(0, this.legs.length - 1);
    }

    get totalDuration() {
      return (
        this.legs[this.legs.length - 1].arr_time.minutes -
        this.legs[0].dep_time.minutes
      );
    }

    get price() {
      return this.legs.reduce(
        (sum, leg) => sum + leg.priceForClass(this.chosenClass),
        0
      );
    }

    get path() {
      const cities = [
        this.legs[0].dep_city,
        ...this.legs.map((l) => l.arr_city)
      ];
      return cities.join(" → ");
    }

    isValidOnDay(dayAbbrev) {
      return this.legs.every(
        (leg) => !leg.days.length || leg.days.includes(dayAbbrev)
      );
    }
  }

  class Query {
    constructor({
      dep_city,
      arr_city,
      train_type,
      days,
      dep_from,
      dep_to,
      max_price_first,
      max_price_second,
      maxStops,
      minTransfer,
      chosenClass
    }) {
      this.dep_city = dep_city;
      this.arr_city = arr_city;
      this.train_type = train_type;
      this.days = days || [];
      this.dep_from = dep_from;
      this.dep_to = dep_to;
      this.max_price_first = max_price_first;
      this.max_price_second = max_price_second;
      this.maxStops = maxStops;
      this.minTransfer = minTransfer;
      this.chosenClass = chosenClass || "second";
    }

    static fromForm() {
      const depCity = $("from") ? $("from").value.trim() : "";
      const arrCity = $("to") ? $("to").value.trim() : "";
      const trainType = $("traintype") ? $("traintype").value.trim() : "";
      const daysFilterRaw = $("days") ? $("days").value.trim() : "";
      const depFrom = $("depfrom") ? $("depfrom").value.trim() : "";
      const depTo = $("depto") ? $("depto").value.trim() : "";
      const maxStops = parseInt($("maxstops").value, 10) || 0;
      const minTransfer = parseInt($("minxfer").value, 10) || 0;
      const maxFirst =
        $("price1") && $("price1").value !== ""
          ? parseFloat($("price1").value)
          : null;
      const maxSecond =
        $("price2") && $("price2").value !== ""
          ? parseFloat($("price2").value)
          : null;
      const chosenClass = $("class")
        ? $("class").value || "second"
        : "second";

      return new Query({
        dep_city: depCity,
        arr_city: arrCity,
        train_type: trainType,
        days: daysFilterRaw
          ? DayUtils.parseDaysOfOperation(daysFilterRaw)
          : [],
        dep_from: depFrom ? TimeUtils.parseTimeToMin(depFrom) : null,
        dep_to: depTo ? TimeUtils.parseTimeToMin(depTo) : null,
        max_price_first: maxFirst,
        max_price_second: maxSecond,
        maxStops,
        minTransfer,
        chosenClass
      });
    }
  }

  class Traveller {
    constructor(name, age, govId) {
      this.name = name;
      this.age = age;
      this.govId = govId;
    }
  }

  class Ticket {
    constructor(classType, price) {
      this.ticket_id = null;
      this.class_type = classType;
      this.price = price;
    }
  }

  class Reservation {
    constructor(traveller, route, ticket) {
      this.traveller = traveller;
      this.route = route;
      this.ticket = ticket;
    }
  }

  class Trip {
    constructor(tripId, client, reservations, bookingDate) {
      this.trip_id = tripId;
      this.client = client;
      this.reservations = reservations;
      this.booking_date = bookingDate;
    }
  }

  // ---------------- Services ----------------

  class ItineraryService {
    isLayoverAllowed(prevArrMin, nextDepMin, minTransfer) {
      const layover = nextDepMin - prevArrMin;
      if (layover < minTransfer) return false;

      const DAY_START = 6 * 60;
      const NIGHT_START = 22 * 60;
      const isDaytime =
        prevArrMin >= DAY_START && prevArrMin < NIGHT_START;
      return isDaytime ? layover <= 120 : layover <= 30;
    }

    buildTransfers(legs) {
      const transfers = [];
      for (let i = 0; i < legs.length - 1; i++) {
        const curr = legs[i];
        const next = legs[i + 1];
        transfers.push({
          city: curr.arr_city,
          layover: next.dep_time.minutes - curr.arr_time.minutes
        });
      }
      return transfers;
    }

    find(routes, query) {
      if (!query.dep_city || !query.arr_city) return [];

      const filtered = routes.filter(
        (r) => r.matchesDay(query.days) && r.matchesQuery(query)
      );
      const results = [];
      const fromLower = query.dep_city.toLowerCase();
      const toLower = query.arr_city.toLowerCase();
      const chosenClass = query.chosenClass || "second";

      const legPrice = (leg) => leg.priceForClass(chosenClass);
      const isPriceable = (legs) =>
        legs.every((l) => Number.isFinite(legPrice(l)));

      // Direct
      if (query.maxStops >= 0) {
        filtered.forEach((r) => {
          if (
            r.dep_city.toLowerCase() === fromLower &&
            r.arr_city.toLowerCase() === toLower &&
            isPriceable([r])
          ) {
            results.push(
              new Itinerary({
                legs: [r],
                chosenClass,
                transfers: []
              })
            );
          }
        });
      }

      // 1-stop
      if (query.maxStops >= 1) {
        filtered.forEach((r1) => {
          if (r1.dep_city.toLowerCase() !== fromLower) return;
          filtered.forEach((r2) => {
            if (r2.arr_city.toLowerCase() !== toLower) return;
            if (r1.arr_city !== r2.dep_city) return;
            if (r2.dep_time.minutes <= r1.arr_time.minutes) return;
            if (
              !this.isLayoverAllowed(
                r1.arr_time.minutes,
                r2.dep_time.minutes,
                query.minTransfer
              )
            )
              return;
            const legs = [r1, r2];
            if (!isPriceable(legs)) return;
            results.push(
              new Itinerary({
                legs,
                chosenClass,
                transfers: this.buildTransfers(legs)
              })
            );
          });
        });
      }

      // 2-stop
      if (query.maxStops >= 2) {
        filtered.forEach((r1) => {
          if (r1.dep_city.toLowerCase() !== fromLower) return;
          filtered.forEach((r2) => {
            if (r2.dep_city !== r1.arr_city) return;
            if (r2.dep_time.minutes <= r1.arr_time.minutes) return;
            filtered.forEach((r3) => {
              if (r3.arr_city.toLowerCase() !== toLower) return;
              if (r3.dep_city !== r2.arr_city) return;
              if (r3.dep_time.minutes <= r2.arr_time.minutes) return;
              if (
                !this.isLayoverAllowed(
                  r1.arr_time.minutes,
                  r2.dep_time.minutes,
                  query.minTransfer
                )
              )
                return;
              if (
                !this.isLayoverAllowed(
                  r2.arr_time.minutes,
                  r3.dep_time.minutes,
                  query.minTransfer
                )
              )
                return;
              const legs = [r1, r2, r3];
              if (!isPriceable(legs)) return;
              results.push(
                new Itinerary({
                  legs,
                  chosenClass,
                  transfers: this.buildTransfers(legs)
                })
              );
            });
          });
        });
      }

      return results;
    }
  }

  class HeaderNormalizer {
    static pick(row, keys) {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null) {
          const val = row[k];
          if (typeof val === "string" && val.trim() === "") continue;
          return val;
        }
      }
      return "";
    }
  }

  class CSVLoader {
    constructor(renderer) {
      this.renderer = renderer;
    }

    loadRoutesFromCsvData(data) {
      const parsed = [];
      data.forEach((row) => {
        const route = Route.fromCsv(row);
        if (route) parsed.push(route);
      });
      return parsed;
    }

    handleCsvUpload(file, onLoaded) {
      if (!file) {
        this.renderer.setMessage("Please choose a CSV file.");
        return;
      }
      if (typeof Papa === "undefined") {
        this.renderer.setMessage(
          "Papa.parse is not loaded. Check your script includes."
        );
        return;
      }
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const routes = this.loadRoutesFromCsvData(results.data || []);
          onLoaded(routes);
        },
        error: () => {
          this.renderer.setMessage(
            "Error parsing CSV. Please check the file format."
          );
        }
      });
    }
  }

  class ResultRenderer {
    setMessage(text) {
      if ($("msg")) $("msg").textContent = text || "";
    }

    updateKpis(routes, searchResults) {
      const cities = new Set();
      const directPairs = new Set();
      routes.forEach((r) => {
        cities.add(r.dep_city);
        cities.add(r.arr_city);
        directPairs.add(`${r.dep_city}→${r.arr_city}`);
      });

      if ($("kpi-routes")) $("kpi-routes").textContent = routes.length;
      if ($("kpi-cities")) $("kpi-cities").textContent = cities.size;
      if ($("kpi-direct")) $("kpi-direct").textContent = directPairs.size;
      if ($("kpi-results"))
        $("kpi-results").textContent = searchResults.length;
    }

    renderResults(searchResults, selectedIndex) {
      const table = $("results");
      if (!table) return;

      const tbody = table.querySelector("tbody");
      tbody.innerHTML = "";

      const sortBy = $("sort") ? $("sort").value : "duration";
      if (sortBy === "duration") {
        searchResults.sort(
          (a, b) => a.totalDuration - b.totalDuration
        );
      } else if (sortBy === "price") {
        searchResults.sort((a, b) => a.price - b.price);
      }

      searchResults.forEach((res, idx) => {
        const tr = document.createElement("tr");
        const transfersText =
          res.transfers && res.transfers.length
            ? res.transfers
                .map(
                  (t) => `${t.city} (${t.layover} min)`
                )
                .join(", ")
            : "—";

        const legsDetails = res.legs
          .map(
            (l, i) =>
              `Leg ${i + 1}: ${l.dep_city} ${l.dep_time.toString()} → ${
                l.arr_city
              } ${l.arr_time.toString()} (${l.train_type || "N/A"})`
          )
          .join("<br>");

        const trainTypes = [
          ...new Set(res.legs.map((l) => l.train_type || ""))
        ]
          .filter(Boolean)
          .join(", ") || "Mixed";

        tr.innerHTML = `
          <td>${res.stops}</td>
          <td class="nowrap">
            ${res.legs[0].dep_time.toString()} → ${res.legs[
          res.legs.length - 1
        ].arr_time.toString()}
            <br><span class="muted">${res.totalDuration} min</span>
          </td>
          <td>
            €${res.price.toFixed(2)}
            <br><span class="muted">${res.chosenClass} class</span>
          </td>
          <td>${trainTypes}</td>
          <td>${res.legs[0].daysStr || "—"}</td>
          <td>${transfersText}</td>
          <td class="path">${res.path}</td>
          <td>${legsDetails}</td>
          <td>
            <button class="secondary btn-select" data-idx="${idx}">
              Select
            </button>
          </td>
        `;

        if (idx === selectedIndex) {
          tr.style.outline = "1px solid var(--accent)";
        }

        tbody.appendChild(tr);
      });

      if ($("summary")) {
        $("summary").textContent =
          searchResults.length === 0
            ? "No itineraries found."
            : `${searchResults.length} itineraries found.`;
      }
    }

    renderTravellers(travellers) {
      const table = $("travellers-table");
      if (!table) return;
      const tbody = table.querySelector("tbody");
      tbody.innerHTML = "";
      travellers.forEach((t, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${t.name}</td>
          <td>${t.age ?? ""}</td>
          <td>${t.govId}</td>
          <td>
            <button class="secondary btn-remove-trav" data-idx="${idx}">
              Remove
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    renderTripsTable(tbodyId, rows) {
      const table = $(tbodyId);
      if (!table) return;
      const tbody = table.querySelector("tbody");
      tbody.innerHTML = "";
      if (!rows || !rows.length) return;

      rows.forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.trip_id}</td>
          <td>${r.date}</td>
          <td>${r.itinerary}</td>
          <td>${r.fare_class || ""}</td>
          <td>${r.ticket_price != null ? "€" + Number(r.ticket_price).toFixed(2) : ""}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  class BookingService {
    constructor(apiBase) {
      this.apiBase = apiBase;
    }

    async bookTrip(itinerary, travellers, travelDate, fareClass) {
      const travelDay = DayUtils.getDayAbbrevFromDateStr(travelDate);
      if (!itinerary.isValidOnDay(travelDay)) {
        throw new Error(
          `Selected itinerary is not valid on ${travelDay}.`
        );
      }

      const pricePerPassenger = itinerary.price;
      if (!Number.isFinite(pricePerPassenger)) {
        throw new Error(
          "Cannot compute price for selected class on all legs."
        );
      }

      const payload = {
        travel_date: travelDate,
        origin: itinerary.legs[0].dep_city,
        destination: itinerary.legs[itinerary.legs.length - 1].arr_city,
        stops: itinerary.stops,
        total_duration: itinerary.totalDuration,
        fare_class: fareClass,
        path_summary: itinerary.path,
        price_per_passenger: pricePerPassenger,
        travellers: travellers.map((t) => ({
          name: t.name,
          age: t.age,
          gov_id: t.govId
        }))
      };

      const res = await fetch(`${this.apiBase}/trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Booking failed (HTTP ${res.status}).`
        );
      }

      const data = await res.json();
      const ticket = new Ticket(fareClass, pricePerPassenger);
      const reservations = travellers.map(
        (traveller) =>
          new Reservation(traveller, itinerary.legs[0], ticket)
      );

      return new Trip(
        data.trip_id,
        null,
        reservations,
        new Date(travelDate)
      );
    }
  }

  class TripViewService {
    constructor(apiBase) {
      this.apiBase = apiBase;
    }

    async fetchTrips(lastName, govId) {
      const url = `${this.apiBase}/trips?last_name=${encodeURIComponent(
        lastName
      )}&gov_id=${encodeURIComponent(govId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    }
  }

  // ---------------- Application orchestrator ----------------

  class RailSearchApp {
    constructor() {
      this.routes = [];
      this.searchResults = [];
      this.selectedIndex = null;
      this.tempTravellers = [];

      this.renderer = new ResultRenderer();
      this.itineraryService = new ItineraryService();
      this.bookingService = new BookingService(API_BASE);
      this.tripViewService = new TripViewService(API_BASE);
      this.csvLoader = new CSVLoader(this.renderer);
    }

    init() {
      this.renderer.updateKpis(this.routes, this.searchResults);
      this.attachEvents();
      this.loadRoutesFromAPI();
    }

    get selectedItinerary() {
      return this.searchResults[this.selectedIndex];
    }

    attachEvents() {
      if ($("csv")) {
        $("csv").addEventListener("change", (e) => {
          const file = e.target.files[0];
          this.csvLoader.handleCsvUpload(file, (routes) => {
            this.routes = routes;
            this.renderer.updateKpis(
              this.routes,
              this.searchResults
            );
            this.renderer.setMessage(
              routes.length
                ? `Loaded ${routes.length} routes from CSV.`
                : "No valid routes found in CSV."
            );
          });
        });
      }

      if ($("btn-search")) {
        $("btn-search").addEventListener("click", () => {
          this.handleSearch();
        });
      }

      if ($("btn-reset")) {
        $("btn-reset").addEventListener("click", () => {
          this.reset();
        });
      }

      if ($("sort")) {
        $("sort").addEventListener("change", () => {
          if (this.searchResults.length) {
            this.renderer.renderResults(
              this.searchResults,
              this.selectedIndex
            );
          }
        });
      }

      if ($("results")) {
        $("results").addEventListener("click", (e) => {
          const btn = e.target.closest(".btn-select");
          if (!btn) return;
          const idx = Number(btn.dataset.idx);
          if (isNaN(idx) || !this.searchResults[idx]) return;
          this.selectedIndex = idx;
          const sel = this.searchResults[idx];
          if ($("selected-connection")) {
            $("selected-connection").value = `Trip: ${sel.path} | Stops: ${
              sel.stops
            } | Duration: ${sel.totalDuration} min | €${sel.price.toFixed(
              2
            )} (${sel.chosenClass} class)`;
          }
          this.updateBookMessage(
            "Itinerary selected. Add travellers and book.",
            "hint"
          );
          this.renderer.renderResults(
            this.searchResults,
            this.selectedIndex
          );
        });
      }

      if ($("btn-clear-selection")) {
        $("btn-clear-selection").addEventListener("click", () => {
          this.clearSelection();
        });
      }

      if ($("btn-add-traveller")) {
        $("btn-add-traveller").addEventListener("click", () => {
          this.addTraveller();
        });
      }

      if ($("travellers-table")) {
        $("travellers-table").addEventListener("click", (e) => {
          const btn = e.target.closest(".btn-remove-trav");
          if (!btn) return;
          const idx = Number(btn.dataset.idx);
          if (!isNaN(idx)) {
            this.tempTravellers.splice(idx, 1);
            this.renderer.renderTravellers(this.tempTravellers);
          }
        });
      }

      if ($("btn-book")) {
        $("btn-book").addEventListener("click", () => {
          this.bookSelectedTrip();
        });
      }

      if ($("btn-view-trips")) {
        $("btn-view-trips").addEventListener("click", () => {
          this.fetchAndRenderTrips();
        });
      }

      if ($("btn-export")) {
        $("btn-export").addEventListener("click", () => {
          this.exportResultsToCsv();
        });
      }
    }

    async loadRoutesFromAPI() {
      try {
        const res = await fetch(`${API_BASE}/routes`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
          this.renderer.setMessage(
            "Backend reachable but no routes in DB. You can upload a CSV."
          );
          return;
        }

        this.routes = data
          .map((row) => Route.fromBackend(row))
          .filter(Boolean);

        this.renderer.updateKpis(this.routes, this.searchResults);
        this.renderer.setMessage(
          `Loaded ${this.routes.length} routes from backend database.`
        );
      } catch (err) {
        console.warn("Could not load routes from backend:", err);
        this.renderer.setMessage(
          "Could not load routes from backend. You can upload a CSV file."
        );
      }
    }

    handleSearch() {
      if (!this.routes.length) {
        this.renderer.setMessage(
          "No routes loaded. Ensure backend /api/routes is populated or upload a CSV."
        );
        return;
      }

      const query = Query.fromForm();
      if (!query.dep_city || !query.arr_city) {
        this.renderer.setMessage(
          "Please enter both a From and To city."
        );
        return;
      }

      this.selectedIndex = null;
      if ($("selected-connection")) $("selected-connection").value = "";
      this.searchResults = this.itineraryService.find(
        this.routes,
        query
      );
      this.renderer.renderResults(this.searchResults, this.selectedIndex);
      this.renderer.updateKpis(this.routes, this.searchResults);
      this.renderer.setMessage("");
    }

    reset() {
      [
        "from",
        "to",
        "traintype",
        "days",
        "depfrom",
        "depto",
        "price1",
        "price2"
      ].forEach((id) => {
        if ($(id)) $(id).value = "";
      });
      if ($("maxstops")) $("maxstops").value = "2";
      if ($("minxfer")) $("minxfer").value = "10";
      if ($("class")) $("class").value = "second";
      if ($("sort")) $("sort").value = "duration";
      if ($("summary")) $("summary").textContent = "";
      this.renderer.setMessage("");
      this.selectedIndex = null;
      this.searchResults = [];
      if ($("results")) $("results").querySelector("tbody").innerHTML = "";
      if ($("kpi-results")) $("kpi-results").textContent = "0";
      if ($("selected-connection")) $("selected-connection").value = "";
      this.tempTravellers = [];
      this.renderer.renderTravellers(this.tempTravellers);
      this.updateBookMessage("", "hint");
    }

    clearSelection() {
      this.selectedIndex = null;
      if ($("selected-connection")) $("selected-connection").value = "";
      this.updateBookMessage("", "hint");
      this.renderer.renderResults(this.searchResults, this.selectedIndex);
    }

    addTraveller() {
      const name = $("trav-name").value.trim();
      const ageVal = $("trav-age").value;
      const id = $("trav-id").value.trim();

      if (!name || !id) {
        this.updateBookMessage(
          "Traveller name and Government ID are required.",
          "hint error"
        );
        return;
      }

      if (
        this.tempTravellers.some(
          (t) => t.govId.toLowerCase() === id.toLowerCase()
        )
      ) {
        this.updateBookMessage(
          "A traveller with this ID is already added.",
          "hint error"
        );
        return;
      }

      const age = ageVal !== "" && ageVal != null ? Number(ageVal) : null;
      this.tempTravellers.push(new Traveller(name, age, id));
      $("trav-name").value = "";
      $("trav-age").value = "";
      $("trav-id").value = "";
      this.updateBookMessage("", "hint");
      this.renderer.renderTravellers(this.tempTravellers);
    }

    updateBookMessage(text, className) {
      const bookMsg = $("book-msg");
      if (bookMsg) {
        bookMsg.textContent = text;
        bookMsg.className = className || "hint";
      }
    }

    async bookSelectedTrip() {
      const travelDate = $("traveldate").value;
      const fareClass = $("fare-class")
        ? $("fare-class").value || "second"
        : "second";

      if (this.selectedIndex == null || !this.selectedItinerary) {
        this.updateBookMessage(
          "Please select an itinerary to book.",
          "hint error"
        );
        return;
      }
      if (!travelDate) {
        this.updateBookMessage(
          "Please select a travel date.",
          "hint error"
        );
        return;
      }
      if (!this.tempTravellers.length) {
        this.updateBookMessage(
          "Please add at least one traveller.",
          "hint error"
        );
        return;
      }

      try {
        const trip = await this.bookingService.bookTrip(
          this.selectedItinerary,
          this.tempTravellers,
          travelDate,
          fareClass
        );

        this.tempTravellers = [];
        this.renderer.renderTravellers(this.tempTravellers);
        this.selectedIndex = null;
        if ($("selected-connection")) $("selected-connection").value = "";
        this.renderer.renderResults(
          this.searchResults,
          this.selectedIndex
        );
        this.updateBookMessage(
          `Trip booked successfully. Your Trip ID is ${trip.trip_id}.`,
          "hint ok"
        );
      } catch (err) {
        console.error(err);
        this.updateBookMessage(
          "Error booking trip: " + (err.message || "Unknown error"),
          "hint error"
        );
      }
    }

    async fetchAndRenderTrips() {
      const lastName = $("view-lastname").value.trim();
      const govId = $("view-id").value.trim();

      if (!lastName || !govId) {
        this.updateBookMessage(
          "Enter Last Name and Government ID to view trips.",
          "hint error"
        );
        return;
      }

      try {
        const data = await this.tripViewService.fetchTrips(
          lastName,
          govId
        );
        this.renderer.renderTripsTable("trips-upcoming", data.upcoming);
        this.renderer.renderTripsTable("trips-history", data.history);
        this.updateBookMessage("", "hint");
      } catch (err) {
        console.error(err);
        this.updateBookMessage(
          "Error fetching trips. Make sure the backend is running.",
          "hint error"
        );
      }
    }

    exportResultsToCsv() {
      if (!this.searchResults.length) {
        this.renderer.setMessage(
          "No results to export. Run a search first."
        );
        return;
      }

      const rows = [];
      rows.push([
        "Stops",
        "TotalDurationMin",
        "ChosenClass",
        "Price",
        "Path",
        "Transfers",
        "Legs"
      ]);

      this.searchResults.forEach((r) => {
        const transfers = (r.transfers || [])
          .map((t) => `${t.city} (${t.layover} min)`)
          .join(" | ");
        const legs = r.legs
          .map(
            (l, i) =>
              `L${i + 1}:${l.dep_city} ${l.dep_time.toString()}->${l.arr_city} ${l.arr_time.toString()} ${l.train_type}`
          )
          .join(" | ");
        rows.push([
          r.stops,
          r.totalDuration,
          r.chosenClass,
          r.price.toFixed(2),
          r.path,
          transfers,
          legs
        ]);
      });

      const csv = rows
        .map((row) =>
          row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
        )
        .join("\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eu_rail_search_results.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  // ---------------- Init ----------------

  function init() {
    const app = new RailSearchApp();
    app.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
