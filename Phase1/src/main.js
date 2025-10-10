const DAY_ALIASES = { mon: 'Mon', monday: 'Mon', tue: 'Tue', tuesday: 'Tue', wed: 'Wed', wednesday: 'Wed', thu: 'Thu', thursday: 'Thu', fri: 'Fri', friday: 'Fri', sat: 'Sat', saturday: 'Sat', sun: 'Sun', sunday: 'Sun' };

function parseTime(s) {
    s = (s || '').toString().trim();
    if (!s) throw new Error('time empty');
    const fmts = [/^(\d{1,2}):(\d{2})$/, /^(\d{1,2})\.(\d{2})$/, /^(\d{1,2})(\d{2})$/];
    for (const re of fmts) {
        const m = s.match(re);
        if (m) {
            const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
            if (h >= 0 && h < 24 && mm >= 0 && mm < 60) return { h, m: mm };
        }
    }
    throw new Error('Unrecognized time: ' + s);
}
function minutesBetween(t1, t2) {
    let a = t1.h * 60 + t1.m, b = t2.h * 60 + t2.m;
    if (b < a) b += 1440; // wrap to next day
    return b - a;
}
function legDuration(dep, arr) { return minutesBetween(dep, arr); }
function formatHM(mins) { const h = Math.floor(mins / 60), m = mins % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function parseDays(s) {
    if (!s) return new Set();
    const parts = s.replaceAll('/', ',').split(',').map(x => x.trim()).filter(Boolean);
    return new Set(parts.map(p => { const k = p.toLowerCase().replace(/[^a-z]/g, ''); return DAY_ALIASES[k] || (p.slice(0, 3).charAt(0).toUpperCase() + p.slice(1, 3).toLowerCase()); }));
}

function normalizeHeaders(hdrs) {
    // Map common header variants to canonical names
    const lower = Object.fromEntries(hdrs.map(h => [h.toLowerCase().trim(), h]));
    function get(...names) {
        for (const nm of names) { if (lower[nm.toLowerCase()]) return lower[nm.toLowerCase()]; }
        return undefined;
    }
    return {
        route_id: get('route id', 'route_id', 'id'),
        dep_city: get('departure city', 'from', 'departure'),
        arr_city: get('arrival city', 'to', 'arrival'),
        dep_time: get('departure time', 'dep_time', 'depart'),
        arr_time: get('arrival time', 'arr_time', 'arrive'),
        train_type: get('train type', 'train', 'type'),
        days: get('days of operation', 'days', 'operation days'),
        price_first: get('first class ticket rate (in euro)', 'price_first', 'first class'),
        price_second: get('second class ticket rate (in euro)', 'price_second', 'second class'),
    };
}

let ROUTES = [];

function loadCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true, dynamicTyping: false, skipEmptyLines: true,
            complete: (res) => {
                try {
                    const map = normalizeHeaders(res.meta.fields || []);
                    const rows = res.data.map((row, i) => {
                        try {
                            const depT = parseTime(row[map.dep_time]);
                            const arrT = parseTime(row[map.arr_time]);
                            return {
                                route_id: String(row[map.route_id] ?? `row-${i}`),
                                dep_city: String(row[map.dep_city] || '').trim(),
                                arr_city: String(row[map.arr_city] || '').trim(),
                                dep_time: depT,
                                arr_time: arrT,
                                train_type: String(row[map.train_type] || '').trim(),
                                days: parseDays(String(row[map.days] || '')),
                                price_first: parseFloat(String(row[map.price_first] || '0').replace(',', '.')) || 0,
                                price_second: parseFloat(String(row[map.price_second] || '0').replace(',', '.')) || 0,
                                duration: legDuration(depT, arrT),
                            };
                        } catch (e) {
                            console.warn('Skipping row', i, e);
                            return null;
                        }
                    }).filter(Boolean);
                    resolve(rows);
                } catch (err) { reject(err); }
            },
            error: (err) => reject(err)
        });
    });
}

function filterRoutes(routes, q) {
    // IMPORTANT: Do NOT filter by dep_city/arr_city here, or we'll lose intermediate legs
    // needed for 1- and 2-stop connections. We only apply generic filters here.
    const type = q.train_type?.toLowerCase() || null;
    const daySet = q.days && q.days.size ? q.days : null;
    const dtf = q.dep_from; const dtt = q.dep_to;
    const max1 = q.max_price_first, max2 = q.max_price_second;
    return routes.filter(r => {
        if (type && !r.train_type.toLowerCase().includes(type)) return false;
        if (daySet) { const overlap = [...daySet].some(d => r.days.has(d)); if (!overlap) return false; }
        if (dtf) {
            const diff = minutesBetween(dtf, r.dep_time); // 0..1439 relative to dtf
            const dmax = dtt ? minutesBetween(dtf, dtt) : null;
            if (dmax !== null) { if (!(0 <= diff && diff <= dmax)) return false; }
        }
        if (max1 != null && r.price_first > max1) return false;
        if (max2 != null && r.price_second > max2) return false;
        return true;
    });
}

function groupByDep(routes) {
    const m = new Map();
    for (const r of routes) {
        const k = r.dep_city.toLowerCase();
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
    }
    return m;
}

function findItineraries(routes, depCity, arrCity, maxStops = 2, minTransfer = 10) {
    const byDep = groupByDep(routes);
    const results = [];
    const depKey = (depCity || '').toLowerCase();
    const target = (arrCity || '').toLowerCase();

    const mins = (t) => t.h * 60 + t.m; // minutes since midnight (no wrap)

    function addIt(legs) {
        const transfers = [];
        for (let i = 0; i < legs.length - 1; i++) transfers.push(mins(legs[i + 1].dep_time) - mins(legs[i].arr_time));
        results.push({ legs, transfers });
    }

    // 0 stops (direct)
    for (const r of (byDep.get(depKey) || [])) {
        if (r.arr_city.toLowerCase() === target) {
            addIt([r]);
        }
    }

    // 1 stop: A -> X -> B (no cycles, same-day time monotonicity)
    if (maxStops >= 1) {
        for (const r1 of (byDep.get(depKey) || [])) {
            const midKey1 = r1.arr_city.toLowerCase();
            if (midKey1 === depKey) continue; // avoid returning to origin immediately
            for (const r2 of (byDep.get(midKey1) || [])) {
                if (r2.arr_city.toLowerCase() !== target) continue;
                // Same-day only: next departure must be at/after previous arrival (no overnight wrap)
                if (mins(r2.dep_time) < mins(r1.arr_time)) continue;
                const t1 = mins(r2.dep_time) - mins(r1.arr_time);
                if (t1 < minTransfer) continue;
                addIt([r1, r2]);
            }
        }
    }

    // 2 stops: A -> X -> Y -> B (no cycles, same-day time monotonicity)
    if (maxStops >= 2) {
        for (const r1 of (byDep.get(depKey) || [])) {
            const midKey1 = r1.arr_city.toLowerCase();
            if (midKey1 === depKey) continue; // avoid trivial cycle
            for (const r2 of (byDep.get(midKey1) || [])) {
                if (mins(r2.dep_time) < mins(r1.arr_time)) continue; // same-day monotonicity
                const t1 = mins(r2.dep_time) - mins(r1.arr_time);
                if (t1 < minTransfer) continue;
                const midKey2 = r2.arr_city.toLowerCase();
                // prevent cycles: cannot revisit origin or previous stop
                if (midKey2 === depKey || midKey2 === midKey1) continue;
                for (const r3 of (byDep.get(midKey2) || [])) {
                    if (r3.arr_city.toLowerCase() !== target) continue;
                    if (mins(r3.dep_time) < mins(r2.arr_time)) continue; // same-day monotonicity
                    const t2 = mins(r3.dep_time) - mins(r2.arr_time);
                    if (t2 < minTransfer) continue;
                    addIt([r1, r2, r3]);
                }
            }
        }
    }

    // Deduplicate itineraries by their route sequence
    const seen = new Set();
    const dedup = [];
    for (const it of results) {
        const key = it.legs.map(l => l.route_id).join('>');
        if (!seen.has(key)) { seen.add(key); dedup.push(it); }
    }
    return dedup;
}

function totalDuration(it) {
    const legs = it.legs.reduce((a, l) => a + l.duration, 0);
    const xfers = it.transfers.reduce((a, b) => a + b, 0);
    return legs + xfers;
}
function price(it, cls) {
    return it.legs.reduce((a, l) => a + (cls === 'first' ? l.price_first : l.price_second), 0);
}

function render(itins, cls) {
    const tbody = document.querySelector('#results tbody');
    tbody.innerHTML = '';
    for (const it of itins) {
        const stops = Math.max(0, it.legs.length - 1);
        const path = [...it.legs.map(l => `${l.dep_city}(${String(l.dep_time.h).padStart(2, '0')}:${String(l.dep_time.m).padStart(2, '0')})`), `${it.legs.at(-1).arr_city}(${String(it.legs.at(-1).arr_time.h).padStart(2, '0')}:${String(it.legs.at(-1).arr_time.m).padStart(2, '0')})`].join(' → ');
        const legs = it.legs.map((l, i) => `[${i + 1}] ${l.dep_city}→${l.arr_city} ${String(l.dep_time.h).padStart(2, '0')}:${String(l.dep_time.m).padStart(2, '0')}–${String(l.arr_time.h).padStart(2, '0')}:${String(l.arr_time.m).padStart(2, '0')} (${formatHM(l.duration)})`).join(' | ');
        const transfers = it.transfers.length ? it.transfers.map(formatHM).join(', ') : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="nowrap"><span class="badge">${stops}</span></td>
          <td class="nowrap">${formatHM(totalDuration(it))}</td>
          <td class="nowrap">€${price(it, cls).toFixed(2)}</td>
          <td class="nowrap">${transfers}</td>
          <td class="path">${path}</td>
          <td>${legs}</td>
        `;
        tbody.appendChild(tr);
    }
    document.getElementById('kpi-results').textContent = itins.length;
}

function exportCSV(itins, cls) {
    const rows = itins.map(it => ({
        stops: Math.max(0, it.legs.length - 1),
        total_duration: formatHM(totalDuration(it)),
        price: price(it, cls).toFixed(2),
        transfers: it.transfers.length ? it.transfers.map(formatHM).join(' / ') : '',
        path: [...it.legs.map(l => `${l.dep_city}(${String(l.dep_time.h).padStart(2, '0')}:${String(l.dep_time.m).padStart(2, '0')})`), `${it.legs.at(-1).arr_city}(${String(it.legs.at(-1).arr_time.h).padStart(2, '0')}:${String(it.legs.at(-1).arr_time.m).padStart(2, '0')})`].join(' -> '),
        legs: it.legs.map((l, i) => `[${i + 1}] ${l.dep_city}->${l.arr_city} ${String(l.dep_time.h).padStart(2, '0')}:${String(l.dep_time.m).padStart(2, '0')}–${String(l.arr_time.h).padStart(2, '0')}:${String(l.arr_time.m).padStart(2, '0')} (${formatHM(l.duration)})`).join(' | '),
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rail_results.csv';
    document.body.appendChild(a); a.click(); a.remove();
}

// UI bindings
const els = {
    file: document.getElementById('csv'),
    from: document.getElementById('from'),
    to: document.getElementById('to'),
    type: document.getElementById('traintype'),
    days: document.getElementById('days'),
    depFrom: document.getElementById('depfrom'),
    depTo: document.getElementById('depto'),
    cls: document.getElementById('class'),
    maxStops: document.getElementById('maxstops'),
    minXfer: document.getElementById('minxfer'),
    price1: document.getElementById('price1'),
    price2: document.getElementById('price2'),
    sort: document.getElementById('sort'),
    msg: document.getElementById('msg'),
    kpiRoutes: document.getElementById('kpi-routes'),
    kpiCities: document.getElementById('kpi-cities'),
    kpiDirect: document.getElementById('kpi-direct'),
};

let lastResults = [];

els.file.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    els.msg.textContent = '';
    if (!file) { ROUTES = []; render([], els.cls.value); return; }
    try {
        ROUTES = await loadCSV(file);
        const cities = new Set(ROUTES.flatMap(r => [r.dep_city, r.arr_city]));
        els.kpiRoutes.textContent = ROUTES.length;
        els.kpiCities.textContent = cities.size;
        // quick stat: how many direct A->B among all routes
        let direct = 0; const byDep = groupByDep(ROUTES);
        for (const [k, arr] of byDep) { direct += arr.filter(r => arr.some(x => x.dep_city === r.dep_city && x.arr_city === r.arr_city)).length; break; }
        els.kpiDirect.textContent = direct;
        document.getElementById('summary').textContent = `Loaded ${ROUTES.length} routes across ${cities.size} cities`;
    } catch (err) {
        els.msg.innerHTML = `<span class="error">Failed to parse CSV: ${String(err)}</span>`;
    }
});

document.getElementById('btn-reset').addEventListener('click', () => {
    ['from', 'to', 'traintype', 'days', 'depfrom', 'depto', 'price1', 'price2'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('class').value = 'second';
    document.getElementById('maxstops').value = '2';
    document.getElementById('minxfer').value = '10';
    document.getElementById('sort').value = 'duration';
    render([], 'second');
    document.getElementById('summary').textContent = '';
    document.getElementById('kpi-results').textContent = '0';
    els.msg.textContent = '';
});

document.getElementById('btn-search').addEventListener('click', () => {
    if (!ROUTES.length) { els.msg.innerHTML = '<span class="error">Please load a CSV first.</span>'; return; }
    els.msg.textContent = '';
    const q = {
        dep_city: els.from.value.trim() || null,
        arr_city: els.to.value.trim() || null,
        train_type: els.type.value.trim() || null,
        days: new Set((els.days.value || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
            const k = s.toLowerCase().replace(/[^a-z]/g, '');
            return DAY_ALIASES[k] || (s.slice(0, 3).charAt(0).toUpperCase() + s.slice(1, 3).toLowerCase());
        })),
        dep_from: els.depFrom.value ? parseTime(els.depFrom.value) : null,
        dep_to: els.depTo.value ? parseTime(els.depTo.value) : null,
        max_price_first: els.price1.value ? parseFloat(els.price1.value) : null,
        max_price_second: els.price2.value ? parseFloat(els.price2.value) : null,
    };
    const filtered = filterRoutes(ROUTES, q);
    const itins = findItineraries(filtered, q.dep_city || '', q.arr_city || '', parseInt(els.maxStops.value, 10), parseInt(els.minXfer.value, 10));
    const cls = els.cls.value;
    if (els.sort.value === 'price') itins.sort((a, b) => (price(a, cls) - price(b, cls)) || (totalDuration(a) - totalDuration(b)));
    else itins.sort((a, b) => (totalDuration(a) - totalDuration(b)) || (price(a, cls) - price(b, cls)));
    lastResults = itins;
    render(itins, cls);
    const dep = q.dep_city || 'any', arr = q.arr_city || 'any';
    document.getElementById('summary').textContent = `${itins.length} itineraries • From: ${dep} • To: ${arr} • Sorted by ${els.sort.value}`;
});

document.getElementById('btn-export').addEventListener('click', () => {
    if (!lastResults.length) { els.msg.innerHTML = '<span class="error">No results to export.</span>'; return; }
    exportCSV(lastResults, els.cls.value);
});