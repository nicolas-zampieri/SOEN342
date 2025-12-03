// main-2.js — Iteration 3 (backend-connected)
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

  // ---------------- Time & day helpers ----------------

  function parseTimeToMin(str) {
    if (!str) return null;
    const parts = str.trim().split(":");
    if (parts.length !== 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  function minToHHMM(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function getDayAbbrevFromDateStr(ymd) {
    // ymd: "YYYY-MM-DD"
    const [y, mo, d] = ymd.split("-").map(Number);
    const dt = new Date(y, mo - 1, d);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[dt.getDay()];
  }

  function parseDaysOfOperation(str) {
    if (!str) return [];
    return str
      .split(/[,/ ]+/)
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean)
      .map((d) => d[0].toUpperCase() + d.slice(1).toLowerCase()); // Mon, Tue, etc.
  }

  // ---------------- Layover Policy (Iteration 3) ----------------
  // Rules:
  // - Layover >= minTransfer (user input)
  // - Daytime (06:00–22:00): max 120 min
  // - After-hours (22:00–06:00): max 30 min

  function isLayoverAllowed(prevArrMin, nextDepMin, minTransfer) {
    const layover = nextDepMin - prevArrMin;
    if (layover < minTransfer) return false;

    const DAY_START = 6 * 60; // 06:00
    const NIGHT_START = 22 * 60; // 22:00

    const isDaytime = prevArrMin >= DAY_START && prevArrMin < NIGHT_START;
    if (isDaytime) {
      return layover <= 120;
    } else {
      return layover <= 30;
    }
  }

  // ---------------- State ----------------

  let routes = []; // [{ routeId, from, to, dep, arr, depMin, arrMin, duration, trainType, days, daysStr, firstRate, secondRate }]
  let searchResults = [];
  let selectedIndex = null;
  let tempTravellers = [];

  // ---------------- KPI / UI helpers ----------------

  function updateKpis() {
    const routesCount = routes.length;
    const cities = new Set();
    const directPairs = new Set();
    routes.forEach((r) => {
      cities.add(r.from);
      cities.add(r.to);
      directPairs.add(`${r.from}→${r.to}`);
    });

    if ($("kpi-routes")) $("kpi-routes").textContent = routesCount;
    if ($("kpi-cities")) $("kpi-cities").textContent = cities.size;
    if ($("kpi-direct")) $("kpi-direct").textContent = directPairs.size;
    if ($("kpi-results")) $("kpi-results").textContent = searchResults.length;
  }

  function setMessage(text) {
    if ($("msg")) $("msg").textContent = text || "";
  }

  // ---------------- Routes: from CSV (fallback) ----------------

  function loadRoutesFromCsvData(data) {
    routes = [];
    data.forEach((row) => {
      const id =
        row["Route ID"] || row["route_id"] || row["id"] || row[0] || "";
      const from =
        (row["Departure City"] || row["From"] || "").toString().trim();
      const to =
        (row["Arrival City"] || row["To"] || "").toString().trim();
      const dep =
        (row["Departure Time"] || row["Dep"] || "").toString().trim();
      const arr =
        (row["Arrival Time"] || row["Arr"] || "").toString().trim();
      if (!id || !from || !to || !dep || !arr) return;

      const trainType =
        (row["Train Type"] || row["Type"] || "").toString().trim();
      const daysStr =
        (row["Days of Operation"] || row["Days"] || "").toString().trim();
      const firstRate = parseFloat(
        row["First Class ticket rate (in euro)"] ||
          row["First Class"] ||
          row["1st"] ||
          ""
      );
      const secondRate = parseFloat(
        row["Second Class ticket rate (in euro)"] ||
          row["Second Class"] ||
          row["2nd"] ||
          ""
      );

      const depMin = parseTimeToMin(dep);
      const arrMin = parseTimeToMin(arr);
      if (depMin == null || arrMin == null) return;

      routes.push({
        routeId: id.toString(),
        from,
        to,
        dep,
        arr,
        depMin,
        arrMin,
        duration: arrMin - depMin,
        trainType,
        daysStr,
        days: parseDaysOfOperation(daysStr),
        firstRate: isNaN(firstRate) ? null : firstRate,
        secondRate: isNaN(secondRate) ? null : secondRate
      });
    });

    updateKpis();
    setMessage(
      routes.length > 0
        ? `Loaded ${routes.length} routes from CSV.`
        : "No valid routes found in CSV."
    );
  }

  function handleCsvUpload(file) {
    if (!file) {
      setMessage("Please choose a CSV file.");
      return;
    }
    if (typeof Papa === "undefined") {
      setMessage("Papa.parse is not loaded. Check your script includes.");
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        loadRoutesFromCsvData(results.data || []);
      },
      error: function () {
        setMessage("Error parsing CSV. Please check the file format.");
      }
    });
  }

  // ---------------- Routes: from backend (preferred) ----------------

  async function loadRoutesFromAPI() {
    try {
      const res = await fetch(`${API_BASE}/routes`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setMessage(
          "Backend reachable but no routes in DB. You can upload a CSV."
        );
        return;
      }

      routes = data
        .map((row) => {
          const id = row.route_id || row.id;
          const from = row.departure_city;
          const to = row.arrival_city;
          const dep = row.departure_time;
          const arr = row.arrival_time;
          if (!id || !from || !to || !dep || !arr) return null;

          const depMin = parseTimeToMin(dep);
          const arrMin = parseTimeToMin(arr);
          if (depMin == null || arrMin == null) return null;

          const daysStr = row.days_of_op || "";
          const firstRate =
            row.first_class !== null ? Number(row.first_class) : null;
          const secondRate =
            row.second_class !== null ? Number(row.second_class) : null;

          return {
            routeId: String(id),
            from: String(from),
            to: String(to),
            dep: String(dep),
            arr: String(arr),
            depMin,
            arrMin,
            duration: arrMin - depMin,
            trainType: row.train_type || "",
            daysStr,
            days: parseDaysOfOperation(daysStr),
            firstRate: isNaN(firstRate) ? null : firstRate,
            secondRate: isNaN(secondRate) ? null : secondRate
          };
        })
        .filter(Boolean);

      updateKpis();
      setMessage(
        `Loaded ${routes.length} routes from backend database.`
      );
    } catch (err) {
      console.warn("Could not load routes from backend:", err);
      // Silent fallback: student can upload CSV instead.
      setMessage(
        "Could not load routes from backend. You can upload a CSV file."
      );
    }
  }

  // ---------------- Filters & search ----------------

  function matchesDay(route, dayFilterArr) {
    if (!dayFilterArr.length) return true;
    if (!route.days.length) return true; // if no info, don't exclude
    return dayFilterArr.some((d) => route.days.includes(d));
  }

  function routeMatchesFilters(route, filters) {
    const {
      traintype,
      depFromMin,
      depToMin,
      maxFirst,
      maxSecond
    } = filters;

    if (traintype && route.trainType) {
      if (
        !route.trainType.toLowerCase().includes(traintype.toLowerCase())
      ) {
        return false;
      }
    }

    if (depFromMin != null && route.depMin < depFromMin) return false;
    if (depToMin != null && route.depMin > depToMin) return false;

    if (maxFirst != null && route.firstRate != null) {
      if (route.firstRate > maxFirst) return false;
    }
    if (maxSecond != null && route.secondRate != null) {
      if (route.secondRate > maxSecond) return false;
    }

    return true;
  }

  function buildConnections() {
    const from = $("from").value.trim();
    const to = $("to").value.trim();
    const traintype = $("traintype") ? $("traintype").value.trim() : "";
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

    if (!from || !to) {
      setMessage("Please enter both a From and To city.");
      return [];
    }

    const daysFilter = daysFilterRaw
      ? parseDaysOfOperation(daysFilterRaw)
      : [];

    const baseFiltered = routes.filter(
      (r) =>
        matchesDay(r, daysFilter) &&
        routeMatchesFilters(r, {
          traintype,
          depFromMin: depFrom ? parseTimeToMin(depFrom) : null,
          depToMin: depTo ? parseTimeToMin(depTo) : null,
          maxFirst,
          maxSecond
        })
    );

    const results = [];
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();

    function legPrice(leg) {
      if (chosenClass === "first") {
        return leg.firstRate != null ? leg.firstRate : Infinity;
      }
      return leg.secondRate != null ? leg.secondRate : Infinity;
    }

    // Direct
    if (maxStops >= 0) {
      baseFiltered.forEach((r) => {
        if (
          r.from.toLowerCase() === fromLower &&
          r.to.toLowerCase() === toLower
        ) {
          const price = legPrice(r);
          if (!isFinite(price)) return;
          results.push({
            legs: [r],
            stops: 0,
            totalDuration: r.duration,
            price,
            chosenClass,
            transfers: [],
            path: `${r.from} → ${r.to}`
          });
        }
      });
    }

    // 1-stop
    if (maxStops >= 1) {
      baseFiltered.forEach((r1) => {
        if (r1.from.toLowerCase() !== fromLower) return;
        baseFiltered.forEach((r2) => {
          if (r2.to.toLowerCase() !== toLower) return;
          if (r1.to !== r2.from) return;
          if (r2.depMin <= r1.arrMin) return;

          if (!isLayoverAllowed(r1.arrMin, r2.depMin, minTransfer)) return;

          const p1 = legPrice(r1);
          const p2 = legPrice(r2);
          if (!isFinite(p1) || !isFinite(p2)) return;

          results.push({
            legs: [r1, r2],
            stops: 1,
            totalDuration: r2.arrMin - r1.depMin,
            price: p1 + p2,
            chosenClass,
            transfers: [
              {
                city: r1.to,
                layover: r2.depMin - r1.arrMin
              }
            ],
            path: `${r1.from} → ${r1.to} → ${r2.to}`
          });
        });
      });
    }

    // 2-stop
    if (maxStops >= 2) {
      baseFiltered.forEach((r1) => {
        if (r1.from.toLowerCase() !== fromLower) return;
        baseFiltered.forEach((r2) => {
          if (r2.from !== r1.to) return;
          if (r2.depMin <= r1.arrMin) return;
          baseFiltered.forEach((r3) => {
            if (r3.to.toLowerCase() !== toLower) return;
            if (r3.from !== r2.to) return;
            if (r3.depMin <= r2.arrMin) return;

            if (!isLayoverAllowed(r1.arrMin, r2.depMin, minTransfer))
              return;
            if (!isLayoverAllowed(r2.arrMin, r3.depMin, minTransfer))
              return;

            const p1 = legPrice(r1);
            const p2 = legPrice(r2);
            const p3 = legPrice(r3);
            if (!isFinite(p1) || !isFinite(p2) || !isFinite(p3)) return;

            results.push({
              legs: [r1, r2, r3],
              stops: 2,
              totalDuration: r3.arrMin - r1.depMin,
              price: p1 + p2 + p3,
              chosenClass,
              transfers: [
                {
                  city: r1.to,
                  layover: r2.depMin - r1.arrMin
                },
                {
                  city: r2.to,
                  layover: r3.depMin - r2.arrMin
                }
              ],
              path: `${r1.from} → ${r1.to} → ${r2.to} → ${r3.to}`
            });
          });
        });
      });
    }

    return results;
  }

  // ---------------- Results rendering ----------------

  function renderResults() {
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
            `Leg ${i + 1}: ${l.from} ${l.dep} → ${l.to} ${l.arr} (${l.trainType || "N/A"})`
        )
        .join("<br>");

      const trainTypes = [
        ...new Set(res.legs.map((l) => l.trainType || ""))
      ]
        .filter(Boolean)
        .join(", ") || "Mixed";

      tr.innerHTML = `
        <td>${res.stops}</td>
        <td class="nowrap">
          ${minToHHMM(res.legs[0].depMin)} → ${minToHHMM(
        res.legs[res.legs.length - 1].arrMin
      )}
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

    updateKpis();
  }

  // ---------------- Travellers (current booking state) ----------------

  function renderTravellers() {
    const table = $("travellers-table");
    if (!table) return;
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    tempTravellers.forEach((t, idx) => {
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

  // ---------------- View Trips rendering ----------------

  function renderTripsTable(tbodyId, rows) {
    const table = $(tbodyId);
    if (!table) return;
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    if (!rows || !rows.length) return;

    rows.forEach((r) => {
      // For backend response: {trip_id, date, itinerary, fare_class, ticket_price}
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

  // ---------------- Booking (calls backend) ----------------

  async function bookSelectedTrip() {
    const travelDate = $("traveldate").value;
    const fareClass = $("fare-class")
      ? $("fare-class").value || "second"
      : "second";
    const bookMsg = $("book-msg");

    if (selectedIndex == null || !searchResults[selectedIndex]) {
      if (bookMsg) {
        bookMsg.textContent = "Please select an itinerary to book.";
        bookMsg.className = "hint error";
      }
      return;
    }
    if (!travelDate) {
      if (bookMsg) {
        bookMsg.textContent = "Please select a travel date.";
        bookMsg.className = "hint error";
      }
      return;
    }
    if (!tempTravellers.length) {
      if (bookMsg) {
        bookMsg.textContent = "Please add at least one traveller.";
        bookMsg.className = "hint error";
      }
      return;
    }

    const conn = searchResults[selectedIndex];
    const travelDay = getDayAbbrevFromDateStr(travelDate);

    // validate days of operation
    for (const leg of conn.legs) {
      if (leg.days.length && !leg.days.includes(travelDay)) {
        if (bookMsg) {
          bookMsg.textContent = `Selected itinerary is not valid on ${travelDay}.`;
          bookMsg.className = "hint error";
        }
        return;
      }
    }

    // compute per-passenger price for chosen class
    const totalPricePerPassenger = conn.legs.reduce((sum, leg) => {
      if (fareClass === "first") {
        return (
          sum +
          (leg.firstRate != null
            ? leg.firstRate
            : Number.POSITIVE_INFINITY)
        );
      }
      return (
        sum +
        (leg.secondRate != null
          ? leg.secondRate
          : Number.POSITIVE_INFINITY)
      );
    }, 0);

    if (!isFinite(totalPricePerPassenger)) {
      if (bookMsg) {
        bookMsg.textContent =
          "Cannot compute price for selected class on all legs.";
        bookMsg.className = "hint error";
      }
      return;
    }

    // build payload for backend
    const payload = {
      travel_date: travelDate,
      origin: conn.legs[0].from,
      destination: conn.legs[conn.legs.length - 1].to,
      stops: conn.stops,
      total_duration: conn.totalDuration,
      fare_class: fareClass,
      path_summary: conn.path,
      price_per_passenger: totalPricePerPassenger,
      travellers: tempTravellers.map((t) => ({
        name: t.name,
        age: t.age,
        gov_id: t.govId
      }))
    };

    try {
      const res = await fetch(`${API_BASE}/trips`, {
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
      const tripId = data.trip_id;

      // clear state
      tempTravellers = [];
      renderTravellers();
      selectedIndex = null;
      if ($("selected-connection"))
        $("selected-connection").value = "";
      renderResults();

      if (bookMsg) {
        bookMsg.textContent = `Trip booked successfully. Your Trip ID is ${tripId}.`;
        bookMsg.className = "hint ok";
      }
    } catch (err) {
      console.error(err);
      if (bookMsg) {
        bookMsg.textContent =
          "Error booking trip: " + (err.message || "Unknown error");
        bookMsg.className = "hint error";
      }
    }
  }

  // ---------------- View Trips (calls backend) ----------------

  async function fetchAndRenderTrips() {
    const lastName = $("view-lastname").value.trim();
    const govId = $("view-id").value.trim();
    const bookMsg = $("book-msg");

    if (!lastName || !govId) {
      if (bookMsg) {
        bookMsg.textContent =
          "Enter Last Name and Government ID to view trips.";
        bookMsg.className = "hint error";
      }
      return;
    }

    try {
      const url = `${API_BASE}/trips?last_name=${encodeURIComponent(
        lastName
      )}&gov_id=${encodeURIComponent(govId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      renderTripsTable("trips-upcoming", data.upcoming);
      renderTripsTable("trips-history", data.history);

      if (bookMsg) {
        bookMsg.textContent = "";
        bookMsg.className = "hint";
      }
    } catch (err) {
      console.error(err);
      if (bookMsg) {
        bookMsg.textContent =
          "Error fetching trips. Make sure the backend is running.";
        bookMsg.className = "hint error";
      }
    }
  }

  // ---------------- Export search results to CSV ----------------

  function exportResultsToCsv() {
    if (!searchResults.length) {
      setMessage("No results to export. Run a search first.");
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

    searchResults.forEach((r) => {
      const transfers = (r.transfers || [])
        .map((t) => `${t.city} (${t.layover} min)`)
        .join(" | ");
      const legs = r.legs
        .map(
          (l, i) =>
            `L${i + 1}:${l.from} ${l.dep}->${l.to} ${l.arr} ${l.trainType}`
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
        row
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
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

  // ---------------- Event wiring ----------------

  function attachEvents() {
    // CSV upload (optional)
    if ($("csv")) {
      $("csv").addEventListener("change", (e) => {
        const file = e.target.files[0];
        handleCsvUpload(file);
      });
    }

    // Search
    if ($("btn-search")) {
      $("btn-search").addEventListener("click", () => {
        if (!routes.length) {
          setMessage(
            "No routes loaded. Ensure backend /api/routes is populated or upload a CSV."
          );
          return;
        }
        selectedIndex = null;
        if ($("selected-connection"))
          $("selected-connection").value = "";
        searchResults = buildConnections();
        renderResults();
      });
    }

    // Reset
    if ($("btn-reset")) {
      $("btn-reset").addEventListener("click", () => {
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
        setMessage("");
        selectedIndex = null;
        searchResults = [];
        if ($("results"))
          $("results").querySelector("tbody").innerHTML = "";
        if ($("kpi-results")) $("kpi-results").textContent = "0";
        if ($("selected-connection"))
          $("selected-connection").value = "";
        tempTravellers = [];
        renderTravellers();
        if ($("book-msg")) {
          $("book-msg").textContent = "";
          $("book-msg").className = "hint";
        }
      });
    }

    // Sort change
    if ($("sort")) {
      $("sort").addEventListener("change", () => {
        if (searchResults.length) renderResults();
      });
    }

    // Select itinerary
    if ($("results")) {
      $("results").addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-select");
        if (!btn) return;
        const idx = Number(btn.dataset.idx);
        if (isNaN(idx) || !searchResults[idx]) return;
        selectedIndex = idx;
        const sel = searchResults[idx];
        if ($("selected-connection")) {
          $("selected-connection").value = `Trip: ${sel.path} | Stops: ${
            sel.stops
          } | Duration: ${sel.totalDuration} min | €${sel.price.toFixed(
            2
          )} (${sel.chosenClass} class)`;
        }
        if ($("book-msg")) {
          $("book-msg").textContent =
            "Itinerary selected. Add travellers and book.";
          $("book-msg").className = "hint";
        }
        renderResults();
      });
    }

    // Clear selection
    if ($("btn-clear-selection")) {
      $("btn-clear-selection").addEventListener("click", () => {
        selectedIndex = null;
        if ($("selected-connection"))
          $("selected-connection").value = "";
        if ($("book-msg")) {
          $("book-msg").textContent = "";
          $("book-msg").className = "hint";
        }
        renderResults();
      });
    }

    // Add traveller
    if ($("btn-add-traveller")) {
      $("btn-add-traveller").addEventListener("click", () => {
        const name = $("trav-name").value.trim();
        const ageVal = $("trav-age").value;
        const id = $("trav-id").value.trim();
        const bookMsg = $("book-msg");

        if (!name || !id) {
          if (bookMsg) {
            bookMsg.textContent =
              "Traveller name and Government ID are required.";
            bookMsg.className = "hint error";
          }
          return;
        }

        if (
          tempTravellers.some(
            (t) => t.govId.toLowerCase() === id.toLowerCase()
          )
        ) {
          if (bookMsg) {
            bookMsg.textContent =
              "A traveller with this ID is already added.";
            bookMsg.className = "hint error";
          }
          return;
        }

        const age =
          ageVal !== "" && ageVal != null ? Number(ageVal) : null;

        tempTravellers.push({ name, age, govId: id });
        $("trav-name").value = "";
        $("trav-age").value = "";
        $("trav-id").value = "";
        if (bookMsg) {
          bookMsg.textContent = "";
          bookMsg.className = "hint";
        }
        renderTravellers();
      });
    }

    // Remove traveller
    if ($("travellers-table")) {
      $("travellers-table").addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-remove-trav");
        if (!btn) return;
        const idx = Number(btn.dataset.idx);
        if (!isNaN(idx)) {
          tempTravellers.splice(idx, 1);
          renderTravellers();
        }
      });
    }

    // Book trip (backend)
    if ($("btn-book")) {
      $("btn-book").addEventListener("click", () => {
        bookSelectedTrip();
      });
    }

    // View trips (backend)
    if ($("btn-view-trips")) {
      $("btn-view-trips").addEventListener("click", () => {
        fetchAndRenderTrips();
      });
    }

    // Export results
    if ($("btn-export")) {
      $("btn-export").addEventListener("click", () => {
        exportResultsToCsv();
      });
    }
  }

  // ---------------- Init ----------------

  function init() {
    updateKpis();
    attachEvents();
    // Try to load routes from backend DB first; if that fails,
    // user can upload CSV to populate routes.
    loadRoutesFromAPI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
