const DAY_ALIASES = {
  mon: 'Mon',
  monday: 'Mon',
  tue: 'Tue',
  tuesday: 'Tue',
  wed: 'Wed',
  wednesday: 'Wed',
  thu: 'Thu',
  thursday: 'Thu',
  fri: 'Fri',
  friday: 'Fri',
  sat: 'Sat',
  saturday: 'Sat',
  sun: 'Sun',
  sunday: 'Sun',
  daily: 'Daily',
};

class DayUtils {
  static normalizeToken(token) {
    const key = token.toLowerCase().replace(/[^a-z]/g, '');
    if (!key) return null;
    if (DAY_ALIASES[key]) return DAY_ALIASES[key];
    const abbr = token.slice(0, 3).toLowerCase();
    if (!abbr) return null;
    return abbr.charAt(0).toUpperCase() + abbr.slice(1);
  }

  static parseDays(raw) {
    if (!raw) return new Set();
    const parts = raw.replaceAll('/', ',').split(',').map((p) => p.trim()).filter(Boolean);
    return new Set(parts.map((p) => DayUtils.normalizeToken(p)).filter(Boolean));
  }

  static parseInputDays(raw) {
    if (!raw) return new Set();
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    return new Set(parts.map((p) => DayUtils.normalizeToken(p)).filter(Boolean));
  }
}

class TimeUtils {
  static parseTime(value) {
    const s = (value || '').toString().trim();
    if (!s) throw new Error('Time value is empty');
    const patterns = [/^(\d{1,2}):(\d{2})$/, /^(\d{1,2})\.(\d{2})$/, /^(\d{1,2})(\d{2})$/];
    for (const re of patterns) {
      const match = s.match(re);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
          return { h: hours, m: minutes };
        }
      }
    }
    throw new Error(`Unrecognized time format: ${s}`);
  }

  static minutesBetween(start, end) {
    const a = start.h * 60 + start.m;
    let b = end.h * 60 + end.m;
    if (b < a) b += 1440;
    return b - a;
  }

  static legDuration(dep, arr) {
    return TimeUtils.minutesBetween(dep, arr);
  }

  static formatHM(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }
}

class HeaderNormalizer {
  static normalize(headers) {
    const lower = Object.fromEntries(headers.map((h) => [h.toLowerCase().trim(), h]));
    const get = (...names) => {
      for (const name of names) {
        const key = name.toLowerCase();
        if (lower[key]) return lower[key];
      }
      return undefined;
    };
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
}

class CSVLoader {
  constructor(parser = Papa) {
    this.parser = parser;
  }

  load(file) {
    return new Promise((resolve, reject) => {
      this.parser.parse(file, {
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (result) => {
          try {
            const headers = result.meta.fields || [];
            const map = HeaderNormalizer.normalize(headers);
            const rows = result.data
              .map((row, index) => {
                try {
                  const depTime = TimeUtils.parseTime(row[map.dep_time]);
                  const arrTime = TimeUtils.parseTime(row[map.arr_time]);
                  return {
                    route_id: String(row[map.route_id] ?? `row-${index}`),
                    dep_city: String(row[map.dep_city] || '').trim(),
                    arr_city: String(row[map.arr_city] || '').trim(),
                    dep_time: depTime,
                    arr_time: arrTime,
                    train_type: String(row[map.train_type] || '').trim(),
                    days: DayUtils.parseDays(String(row[map.days] || '')),
                    price_first: parseFloat(String(row[map.price_first] || '0').replace(',', '.')) || 0,
                    price_second: parseFloat(String(row[map.price_second] || '0').replace(',', '.')) || 0,
                    duration: TimeUtils.legDuration(depTime, arrTime),
                  };
                } catch (error) {
                  console.warn('Skipping row', index, error);
                  return null;
                }
              })
              .filter(Boolean);
            resolve(rows);
          } catch (error) {
            reject(error);
          }
        },
        error: (error) => reject(error),
      });
    });
  }
}

class ItineraryService {
  static filterRoutes(routes, query) {
    const type = query.train_type ? query.train_type.toLowerCase() : null;
    const daySet = query.days && query.days.size ? query.days : null;
    const depFrom = query.dep_from;
    const depTo = query.dep_to;
    const maxFirst = query.max_price_first;
    const maxSecond = query.max_price_second;

    return routes.filter((route) => {
      if (type && !route.train_type.toLowerCase().includes(type)) return false;
      if (daySet) {
        const overlap = [...daySet].some((day) => route.days.has(day));
        if (!overlap) return false;
      }
      if (depFrom) {
        const diff = TimeUtils.minutesBetween(depFrom, route.dep_time);
        const maxDiff = depTo ? TimeUtils.minutesBetween(depFrom, depTo) : null;
        if (maxDiff !== null && !(0 <= diff && diff <= maxDiff)) return false;
      }
      if (maxFirst != null && route.price_first > maxFirst) return false;
      if (maxSecond != null && route.price_second > maxSecond) return false;
      return true;
    });
  }

  static groupByDeparture(routes) {
    const map = new Map();
    for (const route of routes) {
      const key = route.dep_city.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(route);
    }
    return map;
  }

  static findItineraries(routes, depCity, arrCity, maxStops = 2, minTransfer = 10) {
    const byDeparture = ItineraryService.groupByDeparture(routes);
    const results = [];
    const originKey = (depCity || '').toLowerCase();
    const targetKey = (arrCity || '').toLowerCase();
    const absoluteMinutes = (time) => time.h * 60 + time.m;

    const appendItinerary = (legs) => {
      const transfers = [];
      for (let i = 0; i < legs.length - 1; i += 1) {
        transfers.push(absoluteMinutes(legs[i + 1].dep_time) - absoluteMinutes(legs[i].arr_time));
      }
      results.push({ legs, transfers });
    };

    for (const leg of byDeparture.get(originKey) || []) {
      if (leg.arr_city.toLowerCase() === targetKey) appendItinerary([leg]);
    }

    if (maxStops >= 1) {
      for (const leg1 of byDeparture.get(originKey) || []) {
        const midKey = leg1.arr_city.toLowerCase();
        if (midKey === originKey) continue;
        for (const leg2 of byDeparture.get(midKey) || []) {
          if (leg2.arr_city.toLowerCase() !== targetKey) continue;
          if (absoluteMinutes(leg2.dep_time) < absoluteMinutes(leg1.arr_time)) continue;
          const transfer = absoluteMinutes(leg2.dep_time) - absoluteMinutes(leg1.arr_time);
          if (transfer < minTransfer) continue;
          appendItinerary([leg1, leg2]);
        }
      }
    }

    if (maxStops >= 2) {
      for (const leg1 of byDeparture.get(originKey) || []) {
        const midKey1 = leg1.arr_city.toLowerCase();
        if (midKey1 === originKey) continue;
        for (const leg2 of byDeparture.get(midKey1) || []) {
          if (absoluteMinutes(leg2.dep_time) < absoluteMinutes(leg1.arr_time)) continue;
          const transfer1 = absoluteMinutes(leg2.dep_time) - absoluteMinutes(leg1.arr_time);
          if (transfer1 < minTransfer) continue;
          const midKey2 = leg2.arr_city.toLowerCase();
          if (midKey2 === originKey || midKey2 === midKey1) continue;
          for (const leg3 of byDeparture.get(midKey2) || []) {
            if (leg3.arr_city.toLowerCase() !== targetKey) continue;
            if (absoluteMinutes(leg3.dep_time) < absoluteMinutes(leg2.arr_time)) continue;
            const transfer2 = absoluteMinutes(leg3.dep_time) - absoluteMinutes(leg2.arr_time);
            if (transfer2 < minTransfer) continue;
            appendItinerary([leg1, leg2, leg3]);
          }
        }
      }
    }

    const seen = new Set();
    const deduped = [];
    for (const itinerary of results) {
      const key = itinerary.legs.map((leg) => leg.route_id).join('>');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(itinerary);
      }
    }
    return deduped;
  }

  static totalDuration(itinerary) {
    const legs = itinerary.legs.reduce((sum, leg) => sum + leg.duration, 0);
    const transfers = itinerary.transfers.reduce((sum, minutes) => sum + minutes, 0);
    return legs + transfers;
  }

  static price(itinerary, cls) {
    return itinerary.legs.reduce((sum, leg) => {
      return sum + (cls === 'first' ? leg.price_first : leg.price_second);
    }, 0);
  }

  static sort(itineraries, sortBy, cls) {
    const copy = [...itineraries];
    if (sortBy === 'price') {
      copy.sort(
        (a, b) =>
          ItineraryService.price(a, cls) - ItineraryService.price(b, cls)
          || ItineraryService.totalDuration(a) - ItineraryService.totalDuration(b),
      );
    } else {
      copy.sort(
        (a, b) =>
          ItineraryService.totalDuration(a) - ItineraryService.totalDuration(b)
          || ItineraryService.price(a, cls) - ItineraryService.price(b, cls),
      );
    }
    return copy;
  }
}

class ResultRenderer {
  constructor(elements) {
    this.elements = elements;
    this.tableBody = document.querySelector('#results tbody');
    this.summary = document.getElementById('summary');
  }

  render(itineraries, cls) {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = '';
    if (!itineraries.length) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="8" class="muted" style="text-align:center;padding:12px 8px;">No itineraries match the current filters.</td>`;
      this.tableBody.appendChild(row);
      this.updateResultsCount(0);
      return;
    }
    for (const itinerary of itineraries) {
      const stops = Math.max(0, itinerary.legs.length - 1);
      const pathSegments = [
        ...itinerary.legs.map(
          (leg) => `${leg.dep_city}(${String(leg.dep_time.h).padStart(2, '0')}:${String(leg.dep_time.m).padStart(2, '0')})`,
        ),
        `${itinerary.legs.at(-1).arr_city}(${String(itinerary.legs.at(-1).arr_time.h).padStart(2, '0')}:${String(
          itinerary.legs.at(-1).arr_time.m,
        ).padStart(2, '0')})`,
      ];
      const legsText = itinerary.legs
        .map(
          (leg, index) =>
            `[${index + 1}] ${leg.dep_city}→${leg.arr_city} ${String(leg.dep_time.h).padStart(2, '0')}:${String(
              leg.dep_time.m,
            ).padStart(2, '0')}–${String(leg.arr_time.h).padStart(2, '0')}:${String(leg.arr_time.m).padStart(
              2,
              '0',
            )} (${TimeUtils.formatHM(leg.duration)})`,
        )
        .join(' | ');
      const transfers = itinerary.transfers.length
        ? itinerary.transfers.map((minutes) => TimeUtils.formatHM(minutes)).join(', ')
        : '—';
      const trainTypes = itinerary.legs.map((leg) => leg.train_type || '—').join(' | ') || '—';
      const daysText = itinerary.legs
        .map((leg) => {
          const arr = Array.from(leg.days || []);
          return arr.length ? arr.join('/') : '—';
        })
        .join(' | ');

      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="nowrap"><span class="badge">${stops}</span></td>
        <td class="nowrap">${TimeUtils.formatHM(ItineraryService.totalDuration(itinerary))}</td>
        <td class="nowrap">€${ItineraryService.price(itinerary, cls).toFixed(2)}</td>
        <td class="nowrap">${trainTypes}</td>
        <td class="nowrap">${daysText}</td>
        <td class="nowrap">${transfers}</td>
        <td class="path">${pathSegments.join(' → ')}</td>
        <td>${legsText}</td>
      `;
      this.tableBody.appendChild(row);
    }
    this.updateResultsCount(itineraries.length);
  }

  clearResults() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = '';
    this.updateResultsCount(0);
  }

  updateSummary(info) {
    if (!this.summary) return;
    this.summary.textContent = info || '';
  }

  updateMessage(message, isError = false) {
    if (!this.elements.msg) return;
    if (!message) {
      this.elements.msg.textContent = '';
      return;
    }
    const kind = isError ? 'error' : 'ok';
    this.elements.msg.innerHTML = `<span class="${kind}">${message}</span>`;
  }

  updateKPIs({ routes = 0, cities = 0, direct = 0 }) {
    if (this.elements.kpiRoutes) this.elements.kpiRoutes.textContent = routes;
    if (this.elements.kpiCities) this.elements.kpiCities.textContent = cities;
    if (this.elements.kpiDirect) this.elements.kpiDirect.textContent = direct;
  }

  resetKPIs() {
    this.updateKPIs({ routes: 0, cities: 0, direct: 0 });
  }

  updateResultsCount(count) {
    if (this.elements.kpiResults) this.elements.kpiResults.textContent = String(count);
  }
}

class RailSearchApp {
  constructor() {
    this.routes = [];
    this.lastResults = [];
    this.elements = {
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
      kpiResults: document.getElementById('kpi-results'),
      resetBtn: document.getElementById('btn-reset'),
      searchBtn: document.getElementById('btn-search'),
      exportBtn: document.getElementById('btn-export'),
    };
    this.loader = new CSVLoader();
    this.renderer = new ResultRenderer(this.elements);
  }

  init() {
    if (!this.elements.file) return;
    this.bindEvents();
    this.renderer.clearResults();
    this.renderer.resetKPIs();
  }

  bindEvents() {
    this.elements.file.addEventListener('change', (event) => this.handleFileChange(event));
    this.elements.resetBtn?.addEventListener('click', () => this.handleReset());
    this.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
    this.elements.exportBtn?.addEventListener('click', () => this.handleExport());
  }

  async handleFileChange(event) {
    const file = event.target.files?.[0];
    this.renderer.updateMessage('');
    if (!file) {
      this.routes = [];
      this.lastResults = [];
      this.renderer.clearResults();
      this.renderer.resetKPIs();
      this.renderer.updateSummary('');
      return;
    }
    try {
      this.routes = await this.loader.load(file);
      const citySet = new Set(this.routes.flatMap((route) => [route.dep_city, route.arr_city]));
      const directPairs = new Set(
        this.routes.map((route) => `${route.dep_city.toLowerCase()}→${route.arr_city.toLowerCase()}`),
      );
      this.renderer.updateKPIs({
        routes: this.routes.length,
        cities: citySet.size,
        direct: directPairs.size,
      });
      this.renderer.updateSummary(`Loaded ${this.routes.length} routes across ${citySet.size} cities`);
    } catch (error) {
      this.renderer.updateMessage(`Failed to parse CSV: ${String(error)}`, true);
    }
  }

  handleReset() {
    ['from', 'to', 'traintype', 'days', 'depfrom', 'depto', 'price1', 'price2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (this.elements.cls) this.elements.cls.value = 'second';
    if (this.elements.maxStops) this.elements.maxStops.value = '2';
    if (this.elements.minXfer) this.elements.minXfer.value = '10';
    if (this.elements.sort) this.elements.sort.value = 'duration';
    this.lastResults = [];
    this.renderer.clearResults();
    this.renderer.updateSummary('');
    this.renderer.updateMessage('');
  }

  buildQuery() {
    const depCity = this.elements.from?.value.trim() || null;
    const arrCity = this.elements.to?.value.trim() || null;
    if (!depCity || !arrCity) {
      this.renderer.updateMessage('Please enter both departure and arrival cities.', true);
      this.renderer.clearResults();
      this.renderer.updateSummary('');
      this.lastResults = [];
      return null;
    }
    if (depCity && arrCity && depCity.toLowerCase() === arrCity.toLowerCase()) {
      this.renderer.updateMessage('Departure and arrival cities must be different.', true);
      this.renderer.clearResults();
      this.renderer.updateSummary('');
      this.lastResults = [];
      return null;
    }

    try {
      const depFrom = this.elements.depFrom?.value ? TimeUtils.parseTime(this.elements.depFrom.value) : null;
      const depTo = this.elements.depTo?.value ? TimeUtils.parseTime(this.elements.depTo.value) : null;
      const days = DayUtils.parseInputDays(this.elements.days?.value || '');
      return {
        dep_city: depCity,
        arr_city: arrCity,
        train_type: this.elements.type?.value.trim() || null,
        days,
        dep_from: depFrom,
        dep_to: depTo,
        max_price_first: this.elements.price1?.value ? parseFloat(this.elements.price1.value) : null,
        max_price_second: this.elements.price2?.value ? parseFloat(this.elements.price2.value) : null,
      };
    } catch (error) {
      this.renderer.updateMessage(String(error), true);
      return null;
    }
  }

  handleSearch() {
    if (!this.routes.length) {
      this.renderer.updateMessage('Please load a CSV first.', true);
      return;
    }
    const query = this.buildQuery();
    if (!query) return;

    const filtered = ItineraryService.filterRoutes(this.routes, query);
    const itineraries = ItineraryService.findItineraries(
      filtered,
      query.dep_city || '',
      query.arr_city || '',
      parseInt(this.elements.maxStops?.value || '2', 10),
      parseInt(this.elements.minXfer?.value || '10', 10),
    );
    const cls = this.elements.cls?.value || 'second';
    const sorted = ItineraryService.sort(itineraries, this.elements.sort?.value || 'duration', cls);
    this.lastResults = sorted;
    this.renderer.render(sorted, cls);
    const summary = `${sorted.length} itineraries • From: ${query.dep_city || 'any'} • To: ${
      query.arr_city || 'any'
    } • Sorted by ${this.elements.sort?.value || 'duration'}`;
    this.renderer.updateSummary(summary);
    this.renderer.updateMessage('');
  }

  handleExport() {
    if (!this.lastResults.length) {
      this.renderer.updateMessage('No results to export.', true);
      return;
    }
    const cls = this.elements.cls?.value || 'second';
    const rows = this.lastResults.map((itinerary) => ({
      stops: Math.max(0, itinerary.legs.length - 1),
      total_duration: TimeUtils.formatHM(ItineraryService.totalDuration(itinerary)),
      price: ItineraryService.price(itinerary, cls).toFixed(2),
      train_types: itinerary.legs.map((leg) => leg.train_type || '').filter(Boolean).join(' | '),
      days: itinerary.legs
        .map((leg) => {
          const arr = Array.from(leg.days || []);
          return arr.length ? arr.join('/') : '';
        })
        .join(' | '),
      transfers: itinerary.transfers.length
        ? itinerary.transfers.map((minutes) => TimeUtils.formatHM(minutes)).join(' / ')
        : '',
      path: [
        ...itinerary.legs.map(
          (leg) => `${leg.dep_city}(${String(leg.dep_time.h).padStart(2, '0')}:${String(leg.dep_time.m).padStart(2, '0')})`,
        ),
        `${itinerary.legs.at(-1).arr_city}(${String(itinerary.legs.at(-1).arr_time.h).padStart(2, '0')}:${String(
          itinerary.legs.at(-1).arr_time.m,
        ).padStart(2, '0')})`,
      ].join(' -> '),
      legs: itinerary.legs
        .map(
          (leg, index) =>
            `[${index + 1}] ${leg.dep_city}->${leg.arr_city} ${String(leg.dep_time.h).padStart(2, '0')}:${String(
              leg.dep_time.m,
            ).padStart(2, '0')}–${String(leg.arr_time.h).padStart(2, '0')}:${String(leg.arr_time.m).padStart(
              2,
              '0',
            )} (${TimeUtils.formatHM(leg.duration)})`,
        )
        .join(' | '),
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'rail_results.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new RailSearchApp();
  app.init();
});
