/* iobroker.kalender — Browser-App v0.5.5 */
'use strict';

// ── Global State ─────────────────────────────────────────────────────────────
const BASE = window.location.origin;
let events         = [];
let birthdays      = [];
let icsEvents      = [];
let icsUrls        = [];
let alexaDevs      = [];
let discoveredAlexaDevs = [];  // cache from /api/alexa-discover
let currentView    = 'month';
let currentDate    = new Date();
let taskFilter     = 'all';
let editEventId    = null;
let editBdayId     = null;
let logPollTimer   = null;
let activeTab      = 'cal';
let editingSegments  = [];
let editingDpActions = [];  // [{id, type, value, name, unit}]

const COLORS       = ['#58a6ff','#3fb950','#f0883e','#f85149','#a371f7','#e3b341','#ff7b72','#39d353'];
const WEEKDAYS_S   = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const WEEKDAYS_L   = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
const MONTHS       = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDateShort(d) {
    if (!d) return '';
    const dd = typeof d === 'string' ? new Date(d + 'T12:00:00') : d;
    return String(dd.getDate()).padStart(2,'0') + '.' + String(dd.getMonth()+1).padStart(2,'0') + '.' + dd.getFullYear();
}
function fmtDate(d) {
    if (!d) return '';
    const dd = typeof d === 'string' ? new Date(d + 'T12:00:00') : d;
    return dd.getDate() + '. ' + MONTHS[dd.getMonth()] + ' ' + dd.getFullYear();
}
function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
}
function dateToStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const DOW_MAP = { mon:0,tue:1,wed:2,thu:3,fri:4,sat:5,sun:6 };

function occursOnDate(ev, dateString) {
    if (!ev || !ev.date) return false;
    if (ev.date === dateString) return true;
    if (!ev.recurrence || ev.recurrence === 'none') return false;
    const base   = new Date(ev.date + 'T12:00:00');
    const target = new Date(dateString + 'T12:00:00');
    if (target <= base) return false;
    if (ev.recurrenceEnd && target > new Date(ev.recurrenceEnd + 'T23:59:59')) return false;
    if (ev.recurrence === 'daily') return true;
    if (ev.recurrence === 'weekly') {
        const days = ev.recurrenceDays && ev.recurrenceDays.length > 0 ? ev.recurrenceDays : null;
        if (days) {
            const dow = (target.getDay() + 6) % 7;
            return days.some(d => DOW_MAP[d] === dow);
        }
        return Math.round((target - base) / 86400000) % 7 === 0;
    }
    if (ev.recurrence === 'workdays') {
        const dow = (target.getDay() + 6) % 7;
        return dow >= 0 && dow <= 4;
    }
    if (ev.recurrence === 'monthly') return base.getDate() === target.getDate();
    if (ev.recurrence === 'yearly')  return base.getMonth() === target.getMonth() && base.getDate() === target.getDate();
    return false;
}

function getEventsForDate(ds) {
    const myEvs  = events.filter(e => occursOnDate(e, ds));
    const myIcs  = icsEvents.filter(e => occursOnDate(e, ds));
    return [...myEvs, ...myIcs];
}

function getBirthdaysForDate(ds) {
    const d = new Date(ds + 'T12:00:00');
    return birthdays.filter(b => {
        if (!b.date) return false;
        const bd = new Date(b.date + 'T12:00:00');
        return bd.getMonth() === d.getMonth() && bd.getDate() === d.getDate();
    });
}

function birthdayDaysUntil(bd) {
    if (!bd || !bd.date) return 999;
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(bd.date + 'T12:00:00');
    let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next = new Date(today.getFullYear()+1, d.getMonth(), d.getDate());
    return Math.round((next - today) / 86400000);
}

function recLabel(r) {
    return { none:'', daily:'T\u00E4glich', workdays:'Werktags', weekly:'W\u00F6chentlich', monthly:'Monatlich', yearly:'J\u00E4hrlich' }[r] || r;
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, p, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body != null) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + p, opts);
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
}

async function loadData() {
    try {
        const d = await api('GET', '/api/data');
        events    = d.events    || [];
        birthdays = d.birthdays || [];
        icsEvents = d.icsEvents || [];
        icsUrls   = d.icsUrls   || [];
        alexaDevs = d.alexaDevices || [];
        updateHeader(d);
    } catch(e) { console.error('loadData', e); }
}


function updateRecurrenceUI() {
    var sel = document.getElementById('ev-recurrence');
    var row = document.getElementById('ev-weekdays-row');
    if (row) row.style.display = (sel && sel.value === 'weekly') ? 'block' : 'none';
}

function selectWeekdays(preset) {
    var cbs = document.querySelectorAll('input[name=ev-wd]');
    cbs.forEach(function(cb) {
        if (preset === 'all')      cb.checked = true;
        if (preset === 'none')     cb.checked = false;
        if (preset === 'workdays') cb.checked = ['mon','tue','wed','thu','fri'].includes(cb.value);
    });
    // Update border colors
    cbs.forEach(function(cb) {
        var lbl = cb.parentElement;
        if (lbl) lbl.style.borderColor = cb.checked ? 'var(--blue)' : 'var(--border)';
    });
}

function updateHeader(d) {
    const today   = todayStr();
    const evToday = events.filter(e => !e.done && occursOnDate(e, today)).length +
                    icsEvents.filter(e => occursOnDate(e, today)).length;
    document.getElementById('hdr-ev').textContent    = events.length + (icsEvents.length ? '+' + icsEvents.length : '');
    document.getElementById('hdr-today').textContent = evToday;
    document.getElementById('hdr-bd').textContent    = birthdays.length;
    const ver = d && d.version ? 'v' + d.version : '';
    const lc  = d && d.lastCheck ? ' | Prüfung: ' + new Date(d.lastCheck).toLocaleString('de-DE') : '';
    var tz  = d && d.timezone ? ' | ' + d.timezone : '';
    document.getElementById('hdr-sub').textContent = ver + lc + tz;
}

function tickClock() {
    const el = document.getElementById('hdr-clock');
    if (!el) return;
    const n = new Date();
    el.textContent = String(n.getHours()).padStart(2,'0') + ':' +
                     String(n.getMinutes()).padStart(2,'0') + ':' +
                     String(n.getSeconds()).padStart(2,'0');
}

function startClock() {
    tickClock();
    // align to next second boundary
    const msToNext = 1000 - (Date.now() % 1000);
    setTimeout(function() { tickClock(); setInterval(tickClock, 1000); }, msToNext);
}

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchTab(id) {
    activeTab = id;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === id));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
    if (id === 'cal')    renderCalendar();
    if (id === 'tasks')  renderTasks();
    if (id === 'bdays')  renderBirthdays();
    if (id === 'logs')   { renderLogs(); startLogPoll(); } else stopLogPoll();
    if (id === 'system') renderSystem();
}

// ── ─────────────────────────────────────────────────────────────────────────
//   CALENDAR
// ─────────────────────────────────────────────────────────────────────────────
function getMonday(d) {
    const r = new Date(d), day = r.getDay(), diff = day === 0 ? -6 : 1 - day;
    r.setDate(r.getDate() + diff); return r;
}

function renderCalendar() {
    const panel = document.getElementById('panel-cal');
    let viewTitle = '';
    if (currentView === 'month') viewTitle = MONTHS[currentDate.getMonth()] + ' ' + currentDate.getFullYear();
    if (currentView === 'week')  { const m = getMonday(currentDate), s = addDays(m,6); viewTitle = fmtDateShort(m) + ' \u2013 ' + fmtDateShort(s); }
    if (currentView === 'day')   viewTitle = WEEKDAYS_L[(currentDate.getDay()+6)%7] + ', ' + fmtDate(currentDate);

    const icsInfo = icsUrls.length > 0 ? '<span class="ics-badge">\uD83D\uDCC6 ' + icsUrls.length + ' ext. Kalender (' + icsEvents.length + ')</span>' : '';

    const toolbar = '<div class="cal-toolbar">' +
        '<button class="btn btn-ghost btn-sm" onclick="calPrev()">&#8249;</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="calToday()">Heute</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="calNext()">&#8250;</button>' +
        '<span class="cal-title">' + esc(viewTitle) + '</span>' +
        '<div style="margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
        icsInfo +
        '<div class="view-btns">' +
        '<div class="view-btn' + (currentView==='day'?'   active':'') + '" onclick="setView(\'day\')">Tag</div>' +
        '<div class="view-btn' + (currentView==='week'?' active':'') + '" onclick="setView(\'week\')">Woche</div>' +
        '<div class="view-btn' + (currentView==='month'?' active':'') + '" onclick="setView(\'month\')">Monat</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="openEventModal(null)">+ Termin</button>' +
        '</div></div>';

    let grid = '';
    if (currentView === 'month') grid = renderMonthGrid();
    if (currentView === 'week')  grid = renderWeekGrid();
    if (currentView === 'day')   grid = renderDayGrid();
    panel.innerHTML = toolbar + grid;
}

function renderMonthGrid() {
    const year = currentDate.getFullYear(), month = currentDate.getMonth(), today = todayStr();
    const firstDay = new Date(year, month, 1), lastDay = new Date(year, month+1, 0);
    const startDow = (firstDay.getDay()+6)%7;
    const startDate = addDays(firstDay, -startDow);
    const totalCells = Math.ceil((startDow + lastDay.getDate()) / 7) * 7;

    let html = '<div class="cal-grid-month">';
    // Day headers with better styling
    const dayColors = ['color:var(--text)','color:var(--text)','color:var(--text)','color:var(--text)','color:var(--text)','color:var(--orange)','color:var(--red)'];
    html += WEEKDAYS_S.map((d,i) => '<div class="cal-day-header" style="' + dayColors[i] + '">' + d + '</div>').join('');

    for (let i = 0; i < totalCells; i++) {
        const cell = addDays(startDate, i), ds = dateToStr(cell);
        const isToday = ds === today, isOther = cell.getMonth() !== month;
        const isWeekend = cell.getDay() === 0 || cell.getDay() === 6;
        const dayEvs  = getEventsForDate(ds), dayBds = getBirthdaysForDate(ds);
        const totalItems = dayBds.length + dayEvs.length;

        const dayNum = isToday
            ? '<span class="cal-today-dot">' + cell.getDate() + '</span>'
            : '<span style="' + (isWeekend && !isOther ? 'color:var(--orange);' : '') + '">' + cell.getDate() + '</span>';

        // Dot summary for days with many events
        let chips = '';
        const maxChips = 3;
        const allItems = [...dayBds.map(b => ({type:'bday',obj:b})), ...dayEvs.map(e => ({type:'ev',obj:e}))];

        allItems.slice(0, maxChips).forEach(item => {
            if (item.type === 'bday') {
                const b = item.obj;
                chips += '<div class="event-chip" style="background:#3d220033;color:#f0883e;border-left:2px solid #f0883e;font-weight:500;" ' +
                    'data-bid="' + esc(b.id) + '" onclick="event.stopPropagation();openBdayModal(this.dataset.bid)">' +
                    '\uD83C\uDF82 ' + esc(b.name) + '</div>';
            } else {
                const e = item.obj, col = e.color || '#58a6ff', isIcs = e.source === 'ics';
                const timeStr = e.triggerTime ? ('\u23F0' + e.triggerTime + ' ') : (e.time ? e.time + ' ' : '');
                chips += '<div class="event-chip" style="background:' + col + '28;color:' + col + ';border-left:2px solid ' + col + ';font-weight:500;" ' +
                    (isIcs ? '' : 'data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)"') + '>' +
                    (isIcs ? '\uD83D\uDCC6 ' : '') + timeStr + esc(e.title) + '</div>';
            }
        });
        if (totalItems > maxChips) {
            chips += '<div class="event-chip" style="background:var(--bg3);color:var(--muted);text-align:center;">+' + (totalItems - maxChips) + ' weitere</div>';
        }

        // Colored dot strip for quick visual overview
        const dotStrip = allItems.length > 0 ? '<div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:3px;">' +
            allItems.slice(0,7).map(item => {
                const col = item.type === 'bday' ? '#f0883e' : (item.obj.color || '#58a6ff');
                return '<span style="width:6px;height:6px;border-radius:50%;background:' + col + ';flex-shrink:0;"></span>';
            }).join('') + '</div>' : '';

        const cellBg = isToday ? 'background:linear-gradient(135deg,#1a2d4a 0%,#1c3a5a 100%);border:1px solid #2d5a8a;' :
                       isOther ? '' : 'border:1px solid var(--border);';

        html += '<div class="cal-cell' + (isOther?' other-month':'') + (isToday?' today':'') + '" style="' + cellBg + '" ' +
            'data-date="' + ds + '" onclick="calCellClick(this.dataset.date)">' +
            '<div class="cal-day-num">' + dayNum +
            (totalItems > 0 && !isToday ? '<span style="font-size:9px;color:var(--dim);font-weight:400;">' + totalItems + '</span>' : '') +
            '</div>' +
            dotStrip + chips + '</div>';
    }
    return html + '</div>';
}

function renderWeekGrid() {
    const mon = getMonday(currentDate), today = todayStr(), now = new Date();
    const curDs = dateToStr(now), curH = now.getHours(), curMin = now.getMinutes();

    let html = '<div class="cal-week" style="height:calc(100vh - 190px);overflow-y:auto;">';
    html += '<div class="week-col-header" style="background:var(--bg1);border-right:1px solid var(--border2);"></div>';
    for (let d = 0; d < 7; d++) {
        const day = addDays(mon, d), ds = dateToStr(day);
        const isToday = ds === today;
        const isWE = day.getDay() === 0 || day.getDay() === 6;
        const bds = getBirthdaysForDate(ds);
        html += '<div class="week-col-header' + (isToday?' today-col':'') + '" style="' + (isWE && !isToday ? 'color:var(--orange);' : '') + '">' +
            WEEKDAYS_S[d] + '<br>' +
            (isToday ? '<span class="cal-today-dot" style="display:inline-flex;width:24px;height:24px;font-size:12px;">' + day.getDate() + '</span>' : '<strong>' + day.getDate() + '</strong>') +
            (bds.length ? '<br><span style="font-size:9px;">\uD83C\uDF82</span>' : '') +
            '</div>';
    }
    for (let h = 0; h < 24; h++) {
        const isCurrentHour = today === curDs && h === curH;
        html += '<div class="week-time-label" style="' + (isCurrentHour ? 'color:var(--blue);font-weight:700;' : '') + '">' +
            String(h).padStart(2,'0') + ':00</div>';
        for (let d = 0; d < 7; d++) {
            const day = addDays(mon, d), ds = dateToStr(day);
            const isNow = ds === curDs && h === curH;
            const slotEvs = getEventsForDate(ds).filter(e => {
                if (e.allDay) return h === 0;
                const t = e.triggerTime || e.time;
                if (!t) return h === 0;
                return parseInt(t.split(':')[0]) === h;
            });
            const chips = slotEvs.map(e => {
                const col = e.color || '#58a6ff';
                return '<div class="week-event" style="background:' + col + '33;color:' + col + ';border-left:2px solid ' + col + ';border-radius:3px;" ' +
                    (e.source !== 'ics' ? 'data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)"' : '') + '>' +
                    (e.triggerTime ? '\u23F0 ' + e.triggerTime + ' ' : '') + esc(e.title) + '</div>';
            }).join('');
            html += '<div class="week-slot" style="' + (isNow ? 'background:#1a2d4a33;' : '') + '" ' +
                'data-date="' + ds + '" data-hour="' + h + '" onclick="calSlotClick(this.dataset.date,this.dataset.hour)">' + chips + '</div>';
        }
    }
    return html + '</div>';
}

function renderDayGrid() {
    const ds = dateToStr(currentDate), today = todayStr(), now = new Date();
    const curHour = now.getHours(), curMin = now.getMinutes();
    const isToday = ds === today;
    let html = '<div style="height:calc(100vh - 190px);overflow-y:auto;border:1px solid var(--border);border-radius:8px;">';

    for (let h = 0; h < 24; h++) {
        const slotEvs = getEventsForDate(ds).filter(e => {
            if (e.allDay) return h === 0;
            const t = e.triggerTime || e.time;
            if (!t) return h === 0;
            return parseInt(t.split(':')[0]) === h;
        });
        const bdChips = h === 0 ? getBirthdaysForDate(ds).map(b =>
            '<div style="background:#3d220055;color:#f0883e;border-left:3px solid #f0883e;border-radius:4px;padding:8px 10px;margin-bottom:5px;cursor:pointer;font-weight:500;" ' +
            'data-bid="' + esc(b.id) + '" onclick="openBdayModal(this.dataset.bid)">\uD83C\uDF82 ' + esc(b.name) + ' hat heute Geburtstag!</div>'
        ).join('') : '';
        const chips = slotEvs.map(e => {
            const col = e.color || '#58a6ff';
            return '<div style="background:' + col + '22;color:' + col + ';border-left:3px solid ' + col + ';border-radius:4px;padding:8px 10px;margin-bottom:5px;' +
                (e.source !== 'ics' ? 'cursor:pointer;"' : '"') +
                (e.source !== 'ics' ? ' data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)"' : '') + '>' +
                (e.triggerTime ? '<strong style="font-size:13px;">\u23F0 ' + e.triggerTime + '</strong> ' : (e.time ? '<strong>' + e.time + '</strong> ' : '')) +
                '<span style="font-weight:600;">' + esc(e.title) + '</span>' +
                (e.description ? '<div style="font-size:11px;opacity:.65;margin-top:2px;">' + esc(e.description.substring(0,100)) + '</div>' : '') + '</div>';
        }).join('');
        const isNow = isToday && h === curHour;
        const timeStr = String(h).padStart(2,'0') + ':00';
        html += '<div style="display:grid;grid-template-columns:52px 1fr;' + (isNow ? 'background:#0d2040;' : '') + '">' +
            '<div style="font-size:11px;color:' + (isNow?'var(--blue)':'var(--dim)') + ';font-family:var(--mono);padding:8px 6px;border-bottom:1px solid var(--border);background:' + (isNow?'#1a2d4a':'var(--bg1)') + ';font-weight:' + (isNow?'700':'400') + ';position:sticky;left:0;">' + timeStr + '</div>' +
            '<div style="padding:6px 10px;border-bottom:1px solid var(--border);background:' + (isNow?'rgba(30,60,100,.2)':'var(--bg2)') + ';min-height:44px;cursor:pointer;" ' +
            'data-date="' + ds + '" data-hour="' + h + '" onclick="calSlotClick(this.dataset.date,this.dataset.hour)">' +
            bdChips + chips +
            (isNow ? '<div style="position:absolute;left:52px;right:0;height:2px;background:var(--blue);opacity:.6;top:' + Math.round(curMin/60*44) + 'px;pointer-events:none;"></div>' : '') +
            '</div></div>';
    }
    return html + '</div>';
}

function calCellClick(ds) { showDayPanel(ds); }
function calSlotClick(ds, h) { showDayPanel(ds, h); }

let _dayPanelDate = null;

function showDayPanel(ds, scrollHour) {
    _dayPanelDate = ds;
    const d    = new Date(ds + 'T12:00:00');
    const label = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'][(d.getDay()+6)%7]
                + ', ' + d.getDate() + '. '
                + ['Januar','Februar','M\u00E4rz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'][d.getMonth()]
                + ' ' + d.getFullYear();

    const dayEvs = getEventsForDate(ds);
    const dayBds = getBirthdaysForDate(ds);
    const all    = [...dayBds.map(b=>({type:'bday',obj:b})), ...dayEvs.map(e=>({type:'ev',obj:e}))];
    all.sort((a,b) => {
        const ta = a.type==='ev' ? (a.obj.triggerTime||a.obj.time||'') : '';
        const tb = b.type==='ev' ? (b.obj.triggerTime||b.obj.time||'') : '';
        return ta.localeCompare(tb);
    });

    // Remove existing panel
    const existing = document.getElementById('day-detail-panel');
    if (existing) existing.remove();

    if (all.length === 0 && !document.getElementById('day-detail-panel')) {
        // No events: open new event modal as before
        openEventModal(null, ds);
        return;
    }

    const rows = all.map(item => {
        if (item.type === 'bday') {
            const b = item.obj;
            const age = new Date().getFullYear() - new Date(b.date+'T12:00:00').getFullYear();
            return '<tr>' +
                '<td style="padding:8px 10px;color:var(--muted);font-size:12px;font-family:var(--mono);white-space:nowrap;">&nbsp;</td>' +
                '<td style="padding:8px 10px;">' +
                '<span style="background:#3d220033;color:#f0883e;border-left:3px solid #f0883e;border-radius:4px;padding:4px 8px;display:inline-block;">' +
                '\uD83C\uDF82 ' + esc(b.name) + ' (' + age + '. Geburtstag)</span></td>' +
                '<td style="padding:8px 10px;">' +
                '<button class="btn btn-ghost btn-sm" data-bid="' + esc(b.id) + '" onclick="openBdayModal(this.dataset.bid)">\u270F\uFE0F</button></td></tr>';
        }
        const e   = item.obj, col = e.color || '#58a6ff';
        const isIcs = e.source === 'ics';
        const t   = e.triggerTime || e.time || '';
        const rec = (e.recurrence && e.recurrence !== 'none')
            ? ' <span class="badge badge-purple" style="font-size:10px;">' + recLabel(e.recurrence) + '</span>' : '';
        return '<tr style="cursor:' + (isIcs?'default':'pointer') + ';" ' +
            (isIcs ? '' : 'data-eid="' + esc(e.id) + '" onclick="openEventModal(this.dataset.eid)"') + '>' +
            '<td style="padding:8px 10px;color:var(--blue);font-size:13px;font-weight:700;font-family:var(--mono);white-space:nowrap;">' +
            (t ? '\u23F0 ' + t : '&nbsp;') + '</td>' +
            '<td style="padding:8px 10px;">' +
            '<span style="border-left:3px solid ' + col + ';padding-left:8px;font-weight:600;">' + esc(e.title) + rec + '</span>' +
            (e.description ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + esc(e.description.substring(0,80)) + '</div>' : '') +
            (e.reminderBefore && e.reminderBefore.value ? '<div style="font-size:10px;color:var(--yellow);">\uD83D\uDD14 ' + e.reminderBefore.value + ' ' + {minutes:'min',hours:'h',days:'Tage'}[e.reminderBefore.unit||'minutes'] + ' vorher</div>' : '') +
            '</td>' +
            '<td style="padding:8px 10px;white-space:nowrap;">' +
            (isIcs ? '<span class="badge badge-purple" style="font-size:10px;">\uD83D\uDCC6 ICS</span>' :
                '<button class="btn btn-ghost btn-sm" data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)">\u270F\uFE0F</button>') +
            '</td></tr>';
    }).join('');

    const panel = document.createElement('div');
    panel.id = 'day-detail-panel';
    panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--bg1);border-top:2px solid var(--blue);border-radius:16px 16px 0 0;z-index:500;max-height:55vh;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.4);';
    panel.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg1);z-index:1;">' +
        '<strong>' + label + '</strong>' +
        '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-primary btn-sm" data-date="' + ds + '" onclick="openEventModal(null,this.dataset.date)">+ Termin</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="var p=document.getElementById(\'day-detail-panel\');if(p)p.remove()">\u2715</button>' +
        '</div></div>' +
        (all.length === 0
            ? '<div style="padding:20px;text-align:center;color:var(--muted);">Keine Termine</div>'
            : '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>');

    document.getElementById('app').appendChild(panel);
}
function setView(v) { currentView = v; renderCalendar(); }
function calToday() { currentDate = new Date(); renderCalendar(); }
function calPrev() {
    if (currentView === 'month') currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1);
    if (currentView === 'week')  currentDate = addDays(currentDate, -7);
    if (currentView === 'day')   currentDate = addDays(currentDate, -1);
    renderCalendar();
}
function calNext() {
    if (currentView === 'month') currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1);
    if (currentView === 'week')  currentDate = addDays(currentDate, 7);
    if (currentView === 'day')   currentDate = addDays(currentDate, 1);
    renderCalendar();
}

// ── ─────────────────────────────────────────────────────────────────────────
//   EVENT MODAL — Full featured
// ─────────────────────────────────────────────────────────────────────────────
function openEventModal(id, defaultDate, defaultHour) {
    editEventId      = id;
    editingSegments  = [];
    const ev     = id ? events.find(e => e.id === id) : null;  // must be BEFORE ev is used
    const modal  = document.getElementById('event-modal-inner');
    // Build dpActions from existing event or start empty
    if (ev && ev.dpActions && ev.dpActions.length > 0) {
        editingDpActions = JSON.parse(JSON.stringify(ev.dpActions));
    } else if (ev && ev.setDatapointId) {
        editingDpActions = [{ id: ev.setDatapointId, type: ev.setDatapointType || 'boolean', value: String(ev.setDatapointValue || ''), name: '', unit: '' }];
    } else {
        editingDpActions = [];
    }
    const ds     = ev ? ev.date : (defaultDate || todayStr());
    const time   = ev ? (ev.time || '') : (defaultHour != null ? String(defaultHour).padStart(2,'0') + ':00' : '');

    if (ev && ev.messageSegments && ev.messageSegments.length > 0) {
        editingSegments = JSON.parse(JSON.stringify(ev.messageSegments));
    }

    const swatches = COLORS.map(c =>
        '<div class="swatch" style="background:' + c + ';" data-color="' + c + '" onclick="pickColor(this.dataset.color)"' +
        ((ev ? ev.color === c : c === '#58a6ff') ? ' class="swatch selected"' : '') + '></div>'
    ).join('');

    const alexaHtml = buildAlexaPickerHtml(ev ? (ev.alexaDatapoints || []) : [], 'ev-alexa', ev ? (ev.alexaVolumes || {}) : {});
    const hasSegments = editingSegments.length > 0;

    modal.innerHTML =
        '<h3>' + (ev ? '\u2702\uFE0F Termin bearbeiten' : '\u2795 Neuer Termin / Aufgabe') + '</h3>' +

        // Basic fields
        '<div class="form-row"><label>Titel *</label>' +
        '<input id="ev-title" type="text" placeholder="Bezeichnung" value="' + esc(ev ? ev.title : '') + '"></div>' +
        '<div class="form-row"><label>Beschreibung</label>' +
        '<textarea id="ev-desc">' + esc(ev ? ev.description : '') + '</textarea></div>' +
        '<div class="form-cols">' +
        '<div class="form-row"><label>Datum *</label><input id="ev-date" type="date" value="' + esc(ds) + '"></div>' +
        '<div class="form-row"><label>Typ</label><select id="ev-type">' +
        ['event','task','reminder'].map(t => '<option value="' + t + '"' + (ev && ev.type === t ? ' selected' : '') + '>' +
            { event: 'Termin', task: 'Aufgabe', reminder: 'Erinnerung' }[t] + '</option>').join('') +
        '</select></div></div>' +
        '<div class="form-cols">' +
        '<div class="form-row"><label>Uhrzeit</label><input id="ev-time" type="time" value="' + esc(time) + '"></div>' +
        '<div class="form-row"><label>Ende</label><input id="ev-endtime" type="time" value="' + esc(ev ? ev.endTime : '') + '"></div></div>' +
        '<div class="form-row"><label><input type="checkbox" id="ev-allday" ' + (ev && ev.allDay ? 'checked' : '') + ' style="width:auto;margin-right:6px;">Ganztägig</label></div>' +
        '<div class="form-row"><label>Farbe</label><div class="color-swatches" id="ev-swatches">' + swatches + '</div>' +
        '<input id="ev-color" type="hidden" value="' + esc(ev ? (ev.color || '#58a6ff') : '#58a6ff') + '"></div>' +
        '<div class="form-cols">' +
        '<div class="form-row"><label>Wiederholung</label><select id="ev-recurrence" onchange="updateRecurrenceUI()">' +
        ['none','daily','workdays','weekly','monthly','yearly'].map(r => '<option value="' + r + '"' + (ev && ev.recurrence === r ? ' selected' : '') + '>' +
            { none:'Keine', daily:'T\u00E4glich', workdays:'Werktags (Mo-Fr)', weekly:'W\u00F6chentlich', monthly:'Monatlich', yearly:'J\u00E4hrlich' }[r] + '</option>').join('') +
        '</select></div>' +
        '<div class="form-row"><label>Bis Datum</label><input id="ev-recend" type="date" value="' + esc(ev ? ev.recurrenceEnd : '') + '"></div></div>' +

        // Wochentage (nur bei w\u00F6chentlich)
        '<div id="ev-weekdays-row" style="display:' + (ev && ev.recurrence === 'weekly' ? 'block' : 'none') + ';margin-bottom:12px;">' +
        '<div class="form-section" style="margin-bottom:6px;">Wochentage</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        [['mon','Mo'],['tue','Di'],['wed','Mi'],['thu','Do'],['fri','Fr'],['sat','Sa'],['sun','So']].map(([d,l]) => {
            const sel = ev && ev.recurrenceDays && ev.recurrenceDays.includes(d);
            return '<label style="display:flex;align-items:center;gap:3px;background:var(--bg3);border:1px solid ' + (sel ? 'var(--blue)' : 'var(--border)') + ';border-radius:6px;padding:5px 10px;cursor:pointer;font-size:13px;">' +
                '<input type="checkbox" name="ev-wd" value="' + d + '"' + (sel ? ' checked' : '') + ' style="width:auto;margin:0;">' +
                l + '</label>';
        }).join('') +
        '<button class="btn btn-ghost btn-sm" onclick="selectWeekdays(\'workdays\')" style="margin-left:8px;">Werktags</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="selectWeekdays(\'all\')">Alle</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="selectWeekdays(\'none\')">Keine</button>' +
        '</div></div>' +

        // Zeit + Erinnerung (ersetzt separaten Trigger-Block)
        '<hr class="form-divider">' +
        '<div class="trigger-box">' +
        '<div class="trigger-box-title">\u23F0 Zeit & Erinnerung</div>' +
        '<div class="form-cols">' +
        '<div class="form-row"><label>Uhrzeit Termin (= Ausl\u00F6ser)</label>' +
        '<input id="ev-time" type="time" value="' + esc(ev ? (ev.triggerTime || ev.time || '') : '') + '"></div>' +
        '<div class="form-row"><label>Erinnerung vorher</label>' +
        '<div style="display:flex;gap:6px;">' +
        '<input id="ev-rem-val" type="number" min="1" max="999" placeholder="z.B. 30" style="width:80px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;" value="' + esc(ev && ev.reminderBefore ? ev.reminderBefore.value : '') + '">' +
        '<select id="ev-rem-unit" style="flex:1;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;">' +
        ['minutes','hours','days'].map(u => '<option value="' + u + '"' + (ev && ev.reminderBefore && ev.reminderBefore.unit === u ? ' selected' : '') + '>' +
            { minutes: 'Minuten', hours: 'Stunden', days: 'Tage' }[u] + '</option>').join('') +
        '</select></div></div></div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:6px;">Die Uhrzeit ist gleichzeitig der Ausl\u00F6ser f\u00FCr Alexa und Datenpunkt-Aktionen.</div>' +
        '</div>' +

        // ── DATAPOINT ACTION ──────────────────────────────────────────────────
        '<hr class="form-divider">' +
        // ── DATAPOINT ACTION ──────────────────────────────────────────────────
        '<hr class="form-divider">' +
        '<div class="form-section">\uD83D\uDD17 Datenpunkt-Aktionen</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Beliebig viele Datenpunkte setzen. Auf State-ID klicken l\u00E4dt Typ und aktuellen Wert automatisch.</div>' +
        '<div id="dp-actions-list">' + buildDpActionsHtml(editingDpActions) + '</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="addDpAction()" style="margin-top:6px;">+ Datenpunkt</button>' +

        // ── ALEXA MESSAGE BUILDER ─────────────────────────────────────────────
        '<hr class="form-divider">' +
        '<div class="form-section">\uD83D\uDDE3\uFE0F Alexa Sprachausgabe</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
        '<span style="font-size:12px;color:var(--muted);">Nachrichten-Modus:</span>' +
        '<div class="view-btns">' +
        '<div class="view-btn' + (!hasSegments ? ' active' : '') + '" onclick="switchMsgMode(\'simple\')" id="msg-btn-simple">Einfach</div>' +
        '<div class="view-btn' + (hasSegments  ? ' active' : '') + '" onclick="switchMsgMode(\'builder\')" id="msg-btn-builder">Nachricht bauen</div>' +
        '</div></div>' +

        '<div id="msg-simple" style="display:' + (!hasSegments ? 'block' : 'none') + ';">' +
        '<div class="form-row"><label>Nachricht</label>' +
        '<input id="ev-alexa-msg" type="text" placeholder="Morgens Poolpumpe einschalten!" value="' + esc(ev && !hasSegments ? ev.alexaMessage : '') + '"></div>' +
        '</div>' +

        '<div id="msg-builder" style="display:' + (hasSegments ? 'block' : 'none') + ';">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Nachricht aus Texten und Datenpunkt-Werten zusammenbauen. Wird live zur Sprachausgabe zusammengesetzt.</div>' +
        '<div id="seg-container"></div>' +
        '<div style="display:flex;gap:8px;margin-top:8px;">' +
        '<button class="btn btn-ghost btn-sm" onclick="addSegment(\'text\')">\u002B Text</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="addSegment(\'datapoint\')">\u002B Datenpunkt</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="previewMessage()" style="margin-left:auto;">\uD83D\uDC41 Vorschau</button>' +
        '</div>' +
        '<div id="msg-preview" style="display:none;background:var(--bg3);border-radius:6px;padding:10px;margin-top:10px;font-size:13px;color:var(--green);">...</div>' +
        '</div>' +

        alexaHtml +

        '<hr class="form-divider">' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        (ev ? '<button class="btn btn-danger" data-eid="' + id + '" onclick="deleteEvent(this.dataset.eid)">L\u00F6schen</button>' : '') +
        '<button class="btn btn-ghost" onclick="closeModal(\'event-modal\')">Abbrechen</button>' +
        '<button class="btn btn-primary" onclick="saveEvent()">Speichern</button>' +
        '</div>';

    document.getElementById('event-modal').classList.add('open');
    renderSegments();
    setTimeout(() => { const el = document.getElementById('ev-title'); if (el) el.focus(); }, 100);
}

function switchMsgMode(mode) {
    document.getElementById('msg-simple').style.display  = mode === 'simple'  ? 'block' : 'none';
    document.getElementById('msg-builder').style.display = mode === 'builder' ? 'block' : 'none';
    document.getElementById('msg-btn-simple').classList.toggle('active',  mode === 'simple');
    document.getElementById('msg-btn-builder').classList.toggle('active', mode === 'builder');
    if (mode === 'builder' && editingSegments.length === 0) addSegment('text');
}

// ── Segment Builder ───────────────────────────────────────────────────────────
function renderSegments() {
    const container = document.getElementById('seg-container');
    if (!container) return;
    if (editingSegments.length === 0) {
        container.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;">Noch keine Segmente. Klicke auf + Text oder + Datenpunkt.</div>';
        return;
    }
    container.innerHTML = editingSegments.map((seg, i) => {
        const isDP = seg.type === 'datapoint';
        return '<div class="seg-row">' +
            '<select class="seg-type-sel" data-idx="' + i + '" onchange="changeSegType(parseInt(this.dataset.idx),this.value)">' +
            '<option value="text"' + (!isDP ? ' selected' : '') + '>Text</option>' +
            '<option value="datapoint"' + (isDP ? ' selected' : '') + '>Datenpunkt</option>' +
            '</select>' +
            '<div class="seg-inner">' +
            (isDP
                ? '<input class="seg-input" type="text" placeholder="State-ID z.B. pool.0.temperature" value="' + esc(seg.stateId || '') + '" ' +
                  'data-idx="' + i + '" oninput="updateSeg(parseInt(this.dataset.idx),\'stateId\',this.value)">' +
                  '<div style="display:flex;gap:6px;">' +
                  '<input class="seg-input" type="text" placeholder="Prefix (z.B. \'Es sind \')" value="' + esc(seg.prefix || '') + '" ' +
                  'data-idx="' + i + '" oninput="updateSeg(parseInt(this.dataset.idx),\'prefix\',this.value)">' +
                  '<input class="seg-input" type="text" placeholder="Suffix (z.B. \' Grad\')" value="' + esc(seg.suffix || '') + '" ' +
                  'data-idx="' + i + '" oninput="updateSeg(parseInt(this.dataset.idx),\'suffix\',this.value)">' +
                  '</div>'
                : '<input class="seg-input" type="text" placeholder="Text eingeben..." value="' + esc(seg.value || '') + '" ' +
                  'data-idx="' + i + '" oninput="updateSeg(parseInt(this.dataset.idx),\'value\',this.value)">'
            ) +
            '</div>' +
            '<button style="background:var(--bg3);border:1px solid var(--border);color:var(--red);border-radius:4px;padding:4px 8px;cursor:pointer;font-size:12px;flex-shrink:0;" ' +
            'data-idx="' + i + '" onclick="removeSeg(parseInt(this.dataset.idx))">\u2715</button>' +
            '</div>';
    }).join('');
}

function addSegment(type) {
    editingSegments.push(type === 'datapoint'
        ? { type: 'datapoint', stateId: '', prefix: '', suffix: '' }
        : { type: 'text', value: '' });
    renderSegments();
}

function removeSeg(idx) {
    editingSegments.splice(idx, 1);
    renderSegments();
}

function changeSegType(idx, type) {
    editingSegments[idx] = type === 'datapoint'
        ? { type: 'datapoint', stateId: '', prefix: '', suffix: '' }
        : { type: 'text', value: '' };
    renderSegments();
}

function updateSeg(idx, field, value) {
    if (editingSegments[idx]) editingSegments[idx][field] = value;
}

async function previewMessage() {
    const preview = document.getElementById('msg-preview');
    if (!preview) return;
    preview.style.display = 'block';
    preview.textContent = 'Lade Datenpunkt-Werte...';
    let msg = '';
    for (const seg of editingSegments) {
        if (seg.type === 'text') {
            msg += seg.value || '';
        } else if (seg.type === 'datapoint' && seg.stateId) {
            try {
                const d = await api('GET', '/api/foreign-state?id=' + encodeURIComponent(seg.stateId));
                const val = d.val != null ? String(d.val) : '?';
                msg += (seg.prefix || '') + val + (seg.suffix || '');
            } catch(e) { msg += (seg.prefix || '') + '[Fehler]' + (seg.suffix || ''); }
        }
    }
    preview.textContent = '\uD83D\uDDE3 "' + (msg.trim() || '(leer)') + '"';
}

// Color picker
function pickColor(c) {
    const inp = document.getElementById('ev-color');
    if (inp) inp.value = c;
    document.querySelectorAll('#ev-swatches .swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === c));
}

// ── Save / Delete Event ───────────────────────────────────────────────────────
async function saveEvent() {
    const title = document.getElementById('ev-title').value.trim();
    if (!title) { alert('Bitte einen Titel eingeben.'); return; }

    const msgBuilderVisible = document.getElementById('msg-builder') &&
        document.getElementById('msg-builder').style.display !== 'none';

    const alexaDatapoints = collectAlexaDatapoints('ev-alexa');
    const ev = {
        title,
        description:       document.getElementById('ev-desc').value,
        date:              document.getElementById('ev-date').value,
        time:              document.getElementById('ev-time').value,
        endTime:           document.getElementById('ev-endtime').value,
        allDay:            document.getElementById('ev-allday').checked,
        type:              document.getElementById('ev-type').value,
        color:             document.getElementById('ev-color').value || '#58a6ff',
        recurrence:        document.getElementById('ev-recurrence').value,
        recurrenceDays:    Array.from(document.querySelectorAll('input[name=ev-wd]:checked')).map(cb => cb.value),
        recurrenceEnd:     document.getElementById('ev-recend').value,
        time:              (document.getElementById('ev-time') || {}).value || '',
        triggerTime:       (document.getElementById('ev-time') || {}).value || '',
        reminderBefore:    (document.getElementById('ev-rem-val') || {}).value
                           ? { value: parseInt(document.getElementById('ev-rem-val').value),
                               unit:  (document.getElementById('ev-rem-unit') || {}).value || 'minutes' }
                           : null,
        dpActions:         JSON.parse(JSON.stringify(editingDpActions)),
        // keep legacy fields for backward compat (first action)
        setDatapointId:    editingDpActions.length > 0 ? editingDpActions[0].id : '',
        setDatapointValue: editingDpActions.length > 0 ? editingDpActions[0].value : '',
        setDatapointType:  editingDpActions.length > 0 ? editingDpActions[0].type : 'boolean',
        iobCounterId:      '',
        iobDatapointId:    '',
        iobDatapointValue: true,
        alexaMessage:      msgBuilderVisible ? '' : (document.getElementById('ev-alexa-msg') ? document.getElementById('ev-alexa-msg').value.trim() : ''),
        messageSegments:   msgBuilderVisible ? JSON.parse(JSON.stringify(editingSegments)) : [],
        alexaDatapoints,
        alexaVolumes: collectAlexaVolumes('ev-alexa')
    };
    try {
        if (editEventId) {
            const updated = await api('PUT', '/api/events/' + editEventId, ev);
            const idx = events.findIndex(e => e.id === editEventId);
            if (idx !== -1) events[idx] = updated;
        } else {
            const created = await api('POST', '/api/events', ev);
            events.push(created);
        }
        closeModal('event-modal');
        refreshCurrentTab();
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function deleteEvent(id) {
    if (!confirm('Termin löschen?')) return;
    await api('DELETE', '/api/events/' + id);
    events = events.filter(e => e.id !== id);
    closeModal('event-modal');
    refreshCurrentTab();
}

async function triggerEventNow(id) {
    const ev = events.find(e => e.id === id);
    if (!ev) return;
    if (!confirm('Jetzt sofort ausf\u00FChren: "' + ev.title + '"?\n\nDadurch werden Alexa-Ansage und Datenpunkt-Aktionen ausgel\u00F6st.')) return;
    try {
        const r = await api('POST', '/api/trigger-event', { id });
        alert('\u2705 Ausgef\u00FChrt! Schau in die Logs f\u00FCr Details.');
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleEventDone(id) {
    const ev = events.find(e => e.id === id);
    if (!ev) return;
    const updated = await api('PUT', '/api/events/' + id, { done: !ev.done, doneDate: !ev.done ? todayStr() : null });
    const idx = events.findIndex(e => e.id === id);
    if (idx !== -1) events[idx] = updated;
    refreshCurrentTab();
}

// ── TASKS TAB ─────────────────────────────────────────────────────────────────
function renderTasks() {
    const panel  = document.getElementById('panel-tasks');
    const today  = todayStr();
    const weekEnd = dateToStr(addDays(new Date(), 7));

    let filtered = [...events];
    // Helper: is an event "active" (upcoming or repeating, not past one-off)
    function isActive(e) {
        if (e.done) return false;
        if (e.recurrence && e.recurrence !== 'none') return true;  // repeating always visible
        if (e.triggerTime) return true;   // timed tasks always visible
        return !e.date || e.date >= today; // only show future/today for one-off
    }
    if (taskFilter === 'today')   filtered = filtered.filter(e => !e.done && occursOnDate(e, today));
    if (taskFilter === 'week')    filtered = filtered.filter(e => !e.done && e.date >= today && e.date <= weekEnd);
    if (taskFilter === 'done')    filtered = filtered.filter(e => e.done);
    if (taskFilter === 'timed')   filtered = filtered.filter(e => !e.done && (e.triggerTime || e.time));
    if (taskFilter === 'wecker')  filtered = filtered.filter(e => !e.done && (e.triggerTime || e.time));
    if (taskFilter === 'all')     filtered = filtered.filter(e => isActive(e));

    filtered.sort((a,b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.triggerTime && !b.triggerTime) return -1;
        if (!a.triggerTime && b.triggerTime) return 1;
        if (a.triggerTime && b.triggerTime) return a.triggerTime.localeCompare(b.triggerTime);
        return (a.date || '').localeCompare(b.date || '');
    });

    const filters = [['all','Alle'],['today','Heute'],['week','Woche'],['timed','\u23F0 Geplant'],['wecker','\u23F0\u23F0 Wecker'],['done','Erledigt']];
    const filterBar = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<div class="view-btns">' +
        filters.map(([k,l]) => '<div class="view-btn' + (taskFilter===k?' active':'') + '" data-f="' + k + '" onclick="setTaskFilter(this.dataset.f)">' + l + '</div>').join('') +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="openEventModal(null)">+ Neu</button>' +
        '<span style="margin-left:auto;color:var(--muted);font-size:12px;">' + filtered.length + ' Eintr\u00E4ge</span>' +
        '</div>';

    if (taskFilter === 'wecker') {
        panel.innerHTML = filterBar + renderWecker(filtered);
        return;
    }
    if (filtered.length === 0) {
        panel.innerHTML = filterBar + '<div class="empty-state"><div class="icon">\uD83D\uDDD3\uFE0F</div><div>Keine Eintr\u00E4ge</div></div>';
        return;
    }

    const cards = filtered.map(e => {
        const col = e.color || '#58a6ff';
        const hasTrigger = !!e.triggerTime;
        const hasAlexaSegs = e.messageSegments && e.messageSegments.length > 0;
        const hasSetDP = (e.dpActions && e.dpActions.length > 0) || !!e.setDatapointId;
        return '<div class="task-card' + (e.done ? ' done' : '') + '" style="border-left:3px solid ' + (e.done ? 'var(--dim)' : col) + ';">' +
            '<div class="task-check' + (e.done ? ' checked' : '') + '" data-eid="' + e.id + '" onclick="toggleEventDone(this.dataset.eid)">' + (e.done ? '\u2713' : '') + '</div>' +
            '<div class="task-body">' +
            '<div class="task-title">' +
            (hasTrigger ? '<span style="color:var(--yellow);font-size:16px;font-weight:800;font-family:var(--mono);">\u23F0 ' +
            (e.triggerTime||e.time) + '</span> ' : '') + esc(e.title) + '</div>' +
            '<div class="task-meta">' +
            (e.date ? '<span class="badge badge-blue">' + fmtDateShort(e.date) + '</span>' : '') +
            (e.recurrence && e.recurrence !== 'none' ? '<span class="badge badge-purple">' + recLabel(e.recurrence) +
            (e.recurrenceDays && e.recurrenceDays.length > 0 ? ' (' + e.recurrenceDays.map(function(d){return {mon:'Mo',tue:'Di',wed:'Mi',thu:'Do',fri:'Fr',sat:'Sa',sun:'So'}[d]||d;}).join(',') + ')' : '') +
            '</span>' : '') +
            (e.reminderBefore && e.reminderBefore.value ? '<span class="badge badge-yellow">\uD83D\uDD14 ' + e.reminderBefore.value + ' ' + {minutes:'min',hours:'h',days:'Tage'}[e.reminderBefore.unit||'minutes'] + ' vorher</span>' : '') +
            (hasSetDP ? '<span class="badge badge-orange">\uD83D\uDD17 ' + (e.dpActions ? e.dpActions.length + ' Aktion' + (e.dpActions.length>1?'en':'') : e.setDatapointId.split('.').slice(-1)[0]) + '</span>' : '') +
            (hasAlexaSegs ? '<span class="badge badge-blue">\uD83D\uDDE3 Segmente</span>' : '') +
            (e.alexaDatapoints && e.alexaDatapoints.length ? '<span class="badge badge-orange">\uD83D\uDDE3 Alexa (' + e.alexaDatapoints.length + ')</span>' : '') +
            '</div>' +
            (hasSetDP && e.dpActions ? e.dpActions.map(function(a){return '<div style="font-size:11px;color:var(--muted);margin-top:2px;">\uD83D\uDD17 ' + esc(a.id) + ' \u2192 <strong>' + esc(String(a.value)) + '</strong></div>';}).join('') : '') +
            (!hasSetDP && e.setDatapointId ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">\uD83D\uDD17 ' + esc(e.setDatapointId) + ' \u2192 ' + esc(String(e.setDatapointValue)) + '</div>' : '') +
            (hasAlexaSegs ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">\uD83D\uDDE3 ' + e.messageSegments.map(s => s.type === 'text' ? esc(s.value.substring(0,20)) : ('[' + esc(s.stateId) + ']')).join('') + '</div>' : '') +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0;">' +
            '<button class="btn btn-ghost btn-sm" title="Jetzt ausf\u00FChren" data-eid="' + e.id + '" onclick="triggerEventNow(this.dataset.eid)">\u25B6</button>' +
            '<button class="btn btn-ghost btn-sm" data-eid="' + e.id + '" onclick="openEventModal(this.dataset.eid)">\u270F\uFE0F</button>' +
            '</div>' +
            '</div>';
    }).join('');

    panel.innerHTML = filterBar + cards;
}


function renderWecker(items) {
    const now  = new Date();
    const hhmm = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const today = todayStr();

    if (items.length === 0) {
        return '<div class="empty-state"><div class="icon">\u23F0</div><div>Keine geplanten Aufgaben</div></div>';
    }

    // Sort by time
    const sorted = [...items].sort((a,b) => {
        const ta = a.triggerTime||a.time||'99:99';
        const tb = b.triggerTime||b.time||'99:99';
        return ta.localeCompare(tb);
    });

    return sorted.map(e => {
        const t      = e.triggerTime || e.time || '';
        const col    = e.color || '#58a6ff';
        const isPast = t && t < hhmm && occursOnDate(e, today);
        const isNow  = t && t === hhmm;
        const rec    = e.recurrence && e.recurrence !== 'none';

        return '<div class="task-card" style="border-left:4px solid ' + col + ';' + (isNow ? 'background:var(--bg3);' : '') + '">' +
            '<div style="display:flex;align-items:center;gap:14px;flex:1;">' +
            '<div style="text-align:center;min-width:64px;">' +
            '<div style="font-size:26px;font-weight:900;font-family:var(--mono);color:' +
            (isNow ? 'var(--green)' : isPast ? 'var(--dim)' : col) + ';">' + (t || '--:--') + '</div>' +
            '<div style="font-size:10px;color:var(--muted);">' + (isNow ? '\u25B6 Jetzt' : isPast ? 'Vorbei' : 'Heute') + '</div>' +
            '</div>' +
            '<div style="flex:1;">' +
            '<div style="font-size:15px;font-weight:600;">' + esc(e.title) + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">' +
            (rec ? '<span class="badge badge-purple">' + recLabel(e.recurrence) + '</span>' : '') +
            (e.reminderBefore && e.reminderBefore.value ? '<span class="badge badge-yellow">\uD83D\uDD14 ' + e.reminderBefore.value + ' ' + {minutes:'min',hours:'h',days:'d'}[e.reminderBefore.unit||'minutes'] + ' vorher</span>' : '') +
            (e.alexaDatapoints && e.alexaDatapoints.length ? '<span class="badge badge-orange">\uD83D\uDDE3 Alexa</span>' : '') +
            '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;">' +
            '<button class="btn btn-ghost btn-sm" title="Jetzt ausf\u00FChren" data-eid="' + e.id + '" onclick="triggerEventNow(this.dataset.eid)">\u25B6</button>' +
            '<button class="btn btn-ghost btn-sm" data-eid="' + e.id + '" onclick="openEventModal(this.dataset.eid)">\u270F\uFE0F</button>' +
            '</div>' +
            '</div></div>';
    }).join('');
}

function setTaskFilter(f) { taskFilter = f; renderTasks(); }

// ── BIRTHDAYS TAB ─────────────────────────────────────────────────────────────
function renderBirthdays() {
    const panel  = document.getElementById('panel-bdays');
    const today  = new Date(); today.setHours(0,0,0,0);
    const sorted = [...birthdays].sort((a,b) => birthdayDaysUntil(a) - birthdayDaysUntil(b));

    const header = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
        '<h2 style="font-size:20px;">\uD83C\uDF82 Geburtstage</h2>' +
        '<button class="btn btn-primary btn-sm" onclick="openBdayModal(null)">+ Geburtstag</button>' +
        '</div>';

    if (sorted.length === 0) {
        panel.innerHTML = header + '<div class="empty-state"><div class="icon">\uD83C\uDF82</div><div>Noch keine Geburtstage</div></div>';
        return;
    }

    const cards = sorted.map(bd => {
        const days = birthdayDaysUntil(bd);
        const isToday = days === 0, isSoon = days <= 7 && days > 0;
        const bdDate  = new Date(bd.date + 'T12:00:00');
        const age     = today.getFullYear() - bdDate.getFullYear() + (days === 0 ? 0 : 1);
        const initials = (bd.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().substr(0,2);

        return '<div class="bday-card' + (isToday ? ' bday-today' : isSoon ? ' bday-soon' : '') + '">' +
            '<div class="bday-avatar">' + (isToday ? '\uD83C\uDF82' : initials) + '</div>' +
            '<div style="flex:1;">' +
            '<div style="font-size:16px;font-weight:700;">' + esc(bd.name) + '</div>' +
            '<div style="font-size:12px;color:var(--muted);">' + fmtDateShort(bd.date) + ' &nbsp;&bull;&nbsp; ' + age + '. Geburtstag</div>' +
            (bd.notifyDaysBefore > 0 ? '<div style="font-size:11px;color:var(--dim);">Erinnerung ' + bd.notifyDaysBefore + ' Tag(e) vorher</div>' : '') +
            '</div>' +
            '<div style="text-align:center;">' +
            '<div class="bday-countdown' + (isToday ? ' today-val' : '') + '">' + (isToday ? '\uD83C\uDF89' : days) + '</div>' +
            '<div style="font-size:10px;color:var(--muted);">' + (isToday ? 'Heute!' : 'Tage') + '</div></div>' +
            '<button class="btn btn-ghost btn-sm" data-bid="' + bd.id + '" onclick="openBdayModal(this.dataset.bid)">\u270F\uFE0F</button>' +
            '</div>';
    }).join('');

    panel.innerHTML = header + cards;
}

function openBdayModal(id) {
    editBdayId = id;
    const bd = id ? birthdays.find(b => b.id === id) : null;
    const modal = document.getElementById('bday-modal-inner');
    const alexaHtml = buildAlexaPickerHtml(bd ? (bd.alexaDatapoints || []) : [], 'bd-alexa', bd ? (bd.alexaVolumes || {}) : {});

    modal.innerHTML =
        '<h3>' + (bd ? '\u2702\uFE0F Geburtstag bearbeiten' : '\uD83C\uDF82 Neuer Geburtstag') + '</h3>' +
        '<div class="form-row"><label>Name *</label><input id="bd-name" type="text" value="' + esc(bd ? bd.name : '') + '"></div>' +
        '<div class="form-row"><label>Geburtsdatum *</label><input id="bd-date" type="date" value="' + esc(bd ? bd.date : '') + '"></div>' +
        '<div class="form-row"><label>Tage vorher erinnern</label><input id="bd-notify" type="number" min="0" max="30" value="' + esc(bd != null ? bd.notifyDaysBefore : 1) + '"></div>' +
        '<hr class="form-divider"><div class="form-section">Alexa Nachricht</div>' +
        '<div class="form-row"><label>Text (Platzhalter: {name}, {age})</label>' +
        '<input id="bd-alexa-msg" type="text" placeholder="Heute hat {name} Geburtstag! Er wird {age} Jahre alt." value="' + esc(bd ? bd.alexaMessage : '') + '"></div>' +
        alexaHtml +
        '<hr class="form-divider">' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        (bd ? '<button class="btn btn-danger" data-bid="' + id + '" onclick="deleteBday(this.dataset.bid)">L\u00F6schen</button>' : '') +
        '<button class="btn btn-ghost" onclick="closeModal(\'bday-modal\')">Abbrechen</button>' +
        '<button class="btn btn-primary" onclick="saveBday()">Speichern</button>' +
        '</div>';

    document.getElementById('bday-modal').classList.add('open');
    setTimeout(() => { const el = document.getElementById('bd-name'); if (el) el.focus(); }, 100);
}

async function saveBday() {
    const name = document.getElementById('bd-name').value.trim();
    const date = document.getElementById('bd-date').value;
    if (!name || !date) { alert('Bitte Name und Datum angeben.'); return; }
    const bd = {
        name, date,
        notifyDaysBefore: parseInt(document.getElementById('bd-notify').value) || 1,
        alexaMessage:     document.getElementById('bd-alexa-msg').value.trim(),
        alexaDatapoints:  collectAlexaDatapoints('bd-alexa'),
        alexaVolumes:    collectAlexaVolumes('bd-alexa')
    };
    try {
        if (editBdayId) {
            const upd = await api('PUT', '/api/birthdays/' + editBdayId, bd);
            const idx = birthdays.findIndex(b => b.id === editBdayId);
            if (idx !== -1) birthdays[idx] = upd;
        } else {
            birthdays.push(await api('POST', '/api/birthdays', bd));
        }
        closeModal('bday-modal');
        renderBirthdays();
        updateHeader({});
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function deleteBday(id) {
    if (!confirm('Geburtstag löschen?')) return;
    await api('DELETE', '/api/birthdays/' + id);
    birthdays = birthdays.filter(b => b.id !== id);
    closeModal('bday-modal');
    renderBirthdays();
}


// ── Datapoint Action Builder ──────────────────────────────────────────────────
function buildDpActionsHtml(actions) {
    if (!actions || actions.length === 0) {
        return '<div style="color:var(--muted);font-size:12px;padding:6px 0;">Noch keine Aktion. Klicke auf + Datenpunkt.</div>';
    }
    return actions.map(function(a, i) {
        var typeOpts = ['boolean','number','string'].map(function(t) {
            return '<option value="' + t + '"' + (a.type === t ? ' selected' : '') + '>' +
                { boolean: 'Boolean', number: 'Zahl', string: 'Text' }[t] + '</option>';
        }).join('');
        var valInput = '';
        if (a.type === 'boolean') {
            valInput = '<select class="seg-input" data-idx="' + i + '" onchange="updateDpAction(' + i + ',\'value\',this.value)">' +
                '<option value="true"' + (String(a.value) === 'true' ? ' selected' : '') + '>true</option>' +
                '<option value="false"' + (String(a.value) === 'false' ? ' selected' : '') + '>false</option>' +
                '</select>';
        } else if (a.type === 'number') {
            valInput = '<input class="seg-input" type="number" step="any" placeholder="Zahl" value="' + esc(String(a.value)) + '" ' +
                'data-idx="' + i + '" oninput="updateDpAction(' + i + ',\'value\',this.value)">';
        } else {
            valInput = '<input class="seg-input" type="text" placeholder="Text" value="' + esc(String(a.value)) + '" ' +
                'data-idx="' + i + '" oninput="updateDpAction(' + i + ',\'value\',this.value)">';
        }
        return '<div class="seg-row" style="align-items:flex-start;">' +
            '<div class="seg-inner" style="gap:6px;">' +
            '<div style="display:flex;gap:6px;align-items:center;">' +
            '<input class="seg-input" type="text" placeholder="State-ID  z.B. pool.0.pump" value="' + esc(a.id) + '" style="flex:1;" ' +
            'data-idx="' + i + '" oninput="updateDpAction(' + i + ',\'id\',this.value)" ' +
            'onblur="loadDpInfo(' + i + ',this.value)">' +
            '<button class="btn btn-ghost btn-sm" style="flex-shrink:0;" data-idx="' + i + '" onclick="loadDpInfoById(parseInt(this.dataset.idx))">\uD83D\uDD04</button>' +
            '</div>' +
            (a.name ? '<div style="font-size:10px;color:var(--green);">' + esc(a.name) + (a.unit ? ' [' + esc(a.unit) + ']' : '') + '</div>' : '') +
            '<div style="display:flex;gap:6px;align-items:center;">' +
            '<select class="seg-type-sel" data-idx="' + i + '" onchange="changeDpType(' + i + ',this.value)">' + typeOpts + '</select>' +
            valInput +
            '</div></div>' +
            '<button style="background:var(--bg3);border:1px solid var(--border);color:var(--red);border-radius:4px;padding:4px 8px;cursor:pointer;font-size:12px;flex-shrink:0;margin-top:2px;" ' +
            'data-idx="' + i + '" onclick="removeDpAction(parseInt(this.dataset.idx))">&times;</button>' +
            '</div>';
    }).join('');
}

function addDpAction() {
    editingDpActions.push({ id: '', type: 'boolean', value: 'true', name: '', unit: '' });
    document.getElementById('dp-actions-list').innerHTML = buildDpActionsHtml(editingDpActions);
}

function removeDpAction(idx) {
    editingDpActions.splice(idx, 1);
    document.getElementById('dp-actions-list').innerHTML = buildDpActionsHtml(editingDpActions);
}

function updateDpAction(idx, field, value) {
    if (editingDpActions[idx]) editingDpActions[idx][field] = value;
}

function changeDpType(idx, newType) {
    if (!editingDpActions[idx]) return;
    editingDpActions[idx].type = newType;
    // Reset value to sensible default
    if (newType === 'boolean') editingDpActions[idx].value = 'true';
    else if (newType === 'number') editingDpActions[idx].value = '0';
    else editingDpActions[idx].value = '';
    document.getElementById('dp-actions-list').innerHTML = buildDpActionsHtml(editingDpActions);
}

function loadDpInfoById(idx) {
    // Find the state-id input for this action row
    var rows = document.querySelectorAll('#dp-actions-list .seg-row');
    if (!rows[idx]) return;
    var input = rows[idx].querySelector('input[type=text]');
    if (input && input.value) loadDpInfo(idx, input.value);
}

async function loadDpInfo(idx, stateId) {
    if (!stateId || stateId.length < 3) return;
    try {
        const d = await api('GET', '/api/object-info?id=' + encodeURIComponent(stateId));
        if (!d.found) return;
        editingDpActions[idx].name = d.name || '';
        editingDpActions[idx].unit = d.unit || '';
        // Auto-set type from ioBroker object definition
        const t = d.type;
        if (t === 'boolean' || t === 'number' || t === 'string') {
            editingDpActions[idx].type = t;
            // Set sensible default value if empty
            if (!editingDpActions[idx].value || editingDpActions[idx].value === 'true' || editingDpActions[idx].value === 'false') {
                if (t === 'boolean') editingDpActions[idx].value = 'true';
                else if (t === 'number') editingDpActions[idx].value = d.currentVal != null ? String(d.currentVal) : '0';
                else editingDpActions[idx].value = d.currentVal != null ? String(d.currentVal) : '';
            }
        }
        document.getElementById('dp-actions-list').innerHTML = buildDpActionsHtml(editingDpActions);
    } catch(e) { /* silent */ }
}

// ── Alexa Picker ─────────────────────────────────────────────────────────────
// selected = string[]  (stateIds),  volumes = { stateId: number }
function buildAlexaPickerHtml(selected, prefix, volumes) {
    selected = selected || [];
    volumes  = volumes  || {};
    var selJson = JSON.stringify(selected);
    var volJson = JSON.stringify(volumes);
    return '<div class="form-section" style="margin-top:12px;">\uD83D\uDDE3 Alexa Ger\u00E4te</div>' +
        '<div id="' + prefix + '-container" data-selected="' + esc(selJson) + '" data-volumes="' + esc(volJson) + '">' +
        '<div id="' + prefix + '-chips" class="alexa-chip-list">' + _buildAlexaChips(selected, volumes, prefix) + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;">' +
        '<select id="' + prefix + '-sel" style="flex:1;min-width:180px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px;">' +
        _buildAlexaOptions(selected) +
        '</select>' +
        '<button class="btn btn-ghost btn-sm" data-p="' + prefix + '" onclick="refreshAlexaInModal(this.dataset.p)" title="Ger\u00E4te aus ioBroker laden">\uD83D\uDD04</button>' +
        '<button class="btn btn-success btn-sm" data-p="' + prefix + '" onclick="addAlexaToTask(this.dataset.p)">+ Hinzuf\u00FCgen</button>' +
        '</div>' +
        '<div id="' + prefix + '-hint" style="font-size:11px;color:var(--dim);margin-top:4px;">' +
        (discoveredAlexaDevs.length === 0 ? '\uD83D\uDD04 Auf Aktualisieren klicken um Ger\u00E4te zu laden.' : discoveredAlexaDevs.length + ' Ger\u00E4te verf\u00FCgbar') +
        '</div></div>';
}

function _buildAlexaOptions(exclude) {
    if (discoveredAlexaDevs.length === 0) {
        return '<option value="">-- Erst \uD83D\uDD04 klicken zum Laden --</option>';
    }
    return '<option value="">-- Ger\u00E4t ausw\u00E4hlen --</option>' +
        discoveredAlexaDevs
            .filter(function(d) { return !exclude.includes(d.stateId); })
            .map(function(d) { return '<option value="' + esc(d.stateId) + '">' + esc(d.name) + '</option>'; })
            .join('');
}

function _buildAlexaChips(selected, volumes, prefix) {
    if (!selected || selected.length === 0) {
        return '<div style="font-size:12px;color:var(--muted);padding:4px 0;">Noch kein Ger\u00E4t gew\u00E4hlt.</div>';
    }
    return selected.map(function(sid) {
        var dev  = discoveredAlexaDevs.find(function(d) { return d.stateId === sid; });
        var name = dev ? dev.name : (sid.split('.')[3] || sid);
        var vol  = (volumes && volumes[sid] != null) ? String(volumes[sid]) : '';
        return '<div class="alexa-chip" style="margin-bottom:6px;flex-direction:column;align-items:stretch;">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span>\uD83D\uDDE3 <strong>' + esc(name) + '</strong></span>' +
            '<span style="font-size:10px;color:var(--dim);flex:1;overflow:hidden;text-overflow:ellipsis;">' + esc(sid) + '</span>' +
            '<button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0;" ' +
            'data-sid="' + esc(sid) + '" data-p="' + prefix + '" onclick="removeAlexaFromTask(this.dataset.p,this.dataset.sid)">&times;</button>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">' +
            '<span style="font-size:11px;color:var(--muted);white-space:nowrap;">\uD83D\uDD0A Lautst\u00E4rke:</span>' +
            '<input type="range" min="0" max="100" value="' + (vol||'') + '" step="5" style="flex:1;accent-color:var(--blue);" ' +
            'data-sid="' + esc(sid) + '" data-p="' + prefix + '" oninput="updateAlexaVolume(this.dataset.p,this.dataset.sid,this.value);document.getElementById(\'' + prefix + '-vol-' + sid.slice(-8) + '\').textContent=this.value">' +
            '<span id="' + prefix + '-vol-' + sid.slice(-8) + '" style="font-size:11px;color:var(--blue);min-width:28px;text-align:right;">' + (vol || '–') + '</span>' +
            '<span style="font-size:11px;color:var(--dim);">%</span>' +
            '</div></div>';
    }).join('');
}

async function refreshAlexaInModal(prefix) {
    var hint = document.getElementById(prefix + '-hint');
    var sel  = document.getElementById(prefix + '-sel');
    if (hint) hint.textContent = '\u23F3 Lade...';
    try {
        var d = await api('GET', '/api/alexa-discover');
        discoveredAlexaDevs = d.devices || [];
        var container = document.getElementById(prefix + '-container');
        var cur = container ? JSON.parse(container.dataset.selected || '[]') : [];
        if (sel) sel.innerHTML = _buildAlexaOptions(cur);
        if (hint) hint.textContent = discoveredAlexaDevs.length + ' Ger\u00E4te gefunden';
    } catch(e) {
        if (hint) hint.textContent = 'Fehler: ' + e.message;
    }
}

function addAlexaToTask(prefix) {
    var sel = document.getElementById(prefix + '-sel');
    if (!sel || !sel.value) { if(sel) sel.focus(); return; }
    var stateId   = sel.value;
    var container = document.getElementById(prefix + '-container');
    if (!container) return;
    var cur = JSON.parse(container.dataset.selected || '[]');
    var vols = JSON.parse(container.dataset.volumes  || '{}');
    if (cur.includes(stateId)) return;
    cur.push(stateId);
    container.dataset.selected = JSON.stringify(cur);
    document.getElementById(prefix + '-chips').innerHTML = _buildAlexaChips(cur, vols, prefix);
    sel.innerHTML = _buildAlexaOptions(cur);
    sel.value = '';
}

function updateAlexaVolume(prefix, stateId, value) {
    var container = document.getElementById(prefix + '-container');
    if (!container) return;
    var vols = JSON.parse(container.dataset.volumes || '{}');
    vols[stateId] = parseInt(value);
    container.dataset.volumes = JSON.stringify(vols);
}

function removeAlexaFromTask(prefix, stateId) {
    var container = document.getElementById(prefix + '-container');
    if (!container) return;
    var cur  = JSON.parse(container.dataset.selected || '[]');
    var vols = JSON.parse(container.dataset.volumes  || '{}');
    cur = cur.filter(function(s) { return s !== stateId; });
    delete vols[stateId];
    container.dataset.selected = JSON.stringify(cur);
    container.dataset.volumes  = JSON.stringify(vols);
    document.getElementById(prefix + '-chips').innerHTML = _buildAlexaChips(cur, vols, prefix);
    var sel = document.getElementById(prefix + '-sel');
    if (sel) sel.innerHTML = _buildAlexaOptions(cur);
}

function collectAlexaDatapoints(prefix) {
    var container = document.getElementById(prefix + '-container');
    if (!container) return [];
    try { return JSON.parse(container.dataset.selected || '[]'); } catch(e) { return []; }
}

function collectAlexaVolumes(prefix) {
    var container = document.getElementById(prefix + '-container');
    if (!container) return {};
    try { return JSON.parse(container.dataset.volumes || '{}'); } catch(e) { return {}; }
}



// ── LOGS TAB ──────────────────────────────────────────────────────────────────
function renderLogs() {
    const panel = document.getElementById('panel-logs');
    panel.innerHTML =
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">' +
        '<select id="log-level" onchange="loadLogs()" style="background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;">' +
        '<option value="all">Alle Level</option><option value="info">INFO</option><option value="warn">WARN</option><option value="error">ERROR</option>' +
        '</select>' +
        '<input id="log-text" type="text" placeholder="Suche..." oninput="loadLogs()" style="background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 10px;font-size:12px;width:180px;">' +
        '<button class="btn btn-ghost btn-sm" onclick="loadLogs()">&#8635; Aktualisieren</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="exportLogs()">&#8681; Export</button>' +
        '</div><div id="log-list"></div>';
    loadLogs();
}

async function loadLogs() {
    try {
        const data = await api('GET', '/api/logs');
        const lv   = (document.getElementById('log-level') || {}).value || 'all';
        const tx   = ((document.getElementById('log-text') || {}).value || '').toLowerCase();
        const el   = document.getElementById('log-list');
        if (!el) return;
        const filtered = data.filter(e =>
            (lv === 'all' || e.level === lv) &&
            (!tx || (e.msg || '').toLowerCase().includes(tx) || (e.cat || '').toLowerCase().includes(tx))
        );
        el.innerHTML = filtered.map(e => {
            const t = new Date(e.ts);
            const ts = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0') + ':' + String(t.getSeconds()).padStart(2,'0');
            return '<div class="log-entry"><span class="log-ts">' + ts + '</span>' +
                '<span class="log-level lv-' + e.level + '">' + (e.level || '').toUpperCase() + '</span>' +
                '<span class="log-cat">' + esc(e.cat) + '</span>' +
                '<span class="log-msg">' + esc(e.msg) + '</span></div>';
        }).join('') || '<div class="empty-state"><div class="icon">\uD83D\uDCCB</div><div>Keine Logs</div></div>';
    } catch(e) {}
}

function exportLogs() {
    api('GET', '/api/logs').then(d => {
        const txt = d.map(e => new Date(e.ts).toISOString() + ' [' + (e.level||'').toUpperCase() + '] [' + e.cat + '] ' + e.msg).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], {type:'text/plain'}));
        a.download = 'kalender-logs-' + todayStr() + '.txt';
        a.click();
    });
}

function startLogPoll() { stopLogPoll(); logPollTimer = setInterval(() => { if (activeTab==='logs') loadLogs(); }, 5000); }
function stopLogPoll()  { if (logPollTimer) { clearInterval(logPollTimer); logPollTimer = null; } }

// ── SYSTEM TAB ────────────────────────────────────────────────────────────────

async function loadTzInfo() {
    const el = document.getElementById('tz-info');
    if (el) el.innerHTML = '<span style="color:var(--muted);">\u23F3 Lade...</span>';
    try {
        const d = await api('GET', '/api/timezone-info');
        if (!el) return;
        const match = d.linuxTz === d.iobTz;
        const syncColor = match ? 'var(--green)' : 'var(--yellow)';
        const syncIcon  = match ? '\u2714 Synchron' : '\u26A0\uFE0F Nicht synchron';
        el.innerHTML =
            '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;margin-bottom:12px;">' +
            '<span style="color:var(--muted);">Linux-Zeitzone:</span><strong>' + esc(d.linuxTz || '?') + '</strong>' +
            '<span style="color:var(--muted);">Linux-Uhrzeit:</span><strong style="font-family:var(--mono);">' + esc(d.linuxTime || '?') + '</strong>' +
            '<span style="color:var(--muted);">NTP-Sync:</span><strong style="color:' + (d.ntpSync ? 'var(--green)' : 'var(--red)') + ';">' + (d.ntpSync ? '\u2714 Aktiv' : '\u2716 Inaktiv') + '</strong>' +
            '<span style="color:var(--muted);">ioBroker-Zeitzone:</span><strong>' + esc(d.iobTz || '?') + '</strong>' +
            '<span style="color:var(--muted);">Status:</span><strong style="color:' + syncColor + ';">' + syncIcon + '</strong>' +
            '</div>' +
            (!match ? '<div style="background:#3d2f00;border:1px solid var(--yellow);border-radius:6px;padding:10px;margin-bottom:10px;font-size:12px;color:var(--yellow);">' +
                '\u26A0\uFE0F Linux-Zeitzone (<strong>' + esc(d.linuxTz) + '</strong>) und ioBroker-Zeitzone (<strong>' + esc(d.iobTz) + '</strong>) stimmen nicht \u00FCberein.<br>' +
                'Der Kalender-Adapter nutzt die ioBroker-Zeitzone. Du kannst Linux auf ioBroker-Zeit synchronisieren:' +
                '</div>' : '') +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            (!match ? '<button class="btn btn-primary" onclick="syncTzToIob()">\uD83D\uDD04 Linux \u2192 ioBroker-Zeit (' + esc(d.iobTz) + ')</button>' : '') +
            '<button class="btn btn-ghost" onclick="syncNtp()">\u23F1 NTP-Sync erzwingen</button>' +
            '</div>';
    } catch(e) {
        if (el) el.innerHTML = '<span style="color:var(--red);">Fehler: ' + esc(e.message) + '</span>';
    }
}

async function syncTzToIob() {
    if (!confirm('Linux-Zeitzone auf ioBroker-Zeitzone setzen?\nDies f\u00FChrt: sudo timedatectl set-timezone <tz>')) return;
    try {
        const r = await api('POST', '/api/timezone-sync');
        alert(r.ok ? '\u2714 Zeitzone gesetzt: ' + r.tz + '\n' + r.output : 'Fehler: ' + r.error);
        loadTzInfo();
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function syncNtp() {
    try {
        const r = await api('POST', '/api/ntp-sync');
        alert(r.ok ? '\u2714 NTP-Sync aktiviert.\n' + r.output : 'Fehler: ' + r.error);
        loadTzInfo();
    } catch(e) { alert('Fehler: ' + e.message); }
}

function renderSystem() {
    const panel  = document.getElementById('panel-system');
    const today  = todayStr();
    const evTd   = events.filter(e => !e.done && occursOnDate(e, today)).length;
    const timed  = events.filter(e => e.triggerTime).length;
    const bdTd   = birthdays.filter(b => { const d = new Date(b.date+'T12:00:00'); const n = new Date(); return d.getMonth()===n.getMonth()&&d.getDate()===n.getDate(); }).length;

    panel.innerHTML =
        '<div class="sys-grid">' +
        '<div class="sys-card"><div class="sys-val">' + events.length + '</div><div class="sys-label">Termine gesamt</div></div>' +
        '<div class="sys-card"><div class="sys-val" style="color:var(--yellow);">' + timed + '</div><div class="sys-label">\u23F0 Geplant</div></div>' +
        '<div class="sys-card"><div class="sys-val" style="color:var(--green);">' + evTd + '</div><div class="sys-label">Heute</div></div>' +
        '<div class="sys-card"><div class="sys-val" style="color:var(--orange);">' + birthdays.length + '</div><div class="sys-label">Geburtstage</div></div>' +
        '</div>' +

        // Zeitzone
        '<div class="card" id="tz-card">' +
        '<div class="card-header"><div class="card-title">\uD83D\uDD52 Zeitzone</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="loadTzInfo()">\uD83D\uDD04 Aktualisieren</button></div>' +
        '<div id="tz-info" style="font-size:13px;">Lade...</div>' +
        '</div>' +

        // ICS
        '<div class="card">' +
        '<div class="card-header"><div class="card-title">\uD83D\uDCC6 Externe Kalender (ICS / iCal / Google Kalender)</div></div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Google Kalender: Kalendereinstellungen \u2192 "Kalender-URL" (iCal-Format). Der Adapter l\u00E4dt diese Kalender st\u00FCndlich und zeigt sie in der Kalenderansicht an (nur lesen).</div>' +
        '<div id="ics-list">' + renderIcsList() + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<input id="new-ics-name" type="text" placeholder="Name" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px;width:150px;">' +
        '<input id="new-ics-url" type="text" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px;flex:1;min-width:200px;">' +
        '<input id="new-ics-color" type="color" value="#a371f7" style="width:40px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);cursor:pointer;">' +
        '<button class="btn btn-primary btn-sm" onclick="addIcsUrl()">+ Hinzuf\u00FCgen</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px;">' +
        '<button class="btn btn-ghost btn-sm" onclick="refreshIcs()">\u21BB Alle aktualisieren</button>' +
        '<span style="font-size:12px;color:var(--muted);align-self:center;">' + icsEvents.length + ' ICS-Eintr\u00E4ge geladen</span>' +
        '</div></div>' +

        // Actions
        '<div class="card">' +
        '<div class="card-header"><div class="card-title">\u2699\uFE0F Aktionen</div></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        '<button class="btn btn-ghost" onclick="triggerDaily()">\u25B6 Tagespr\u00FCfung jetzt</button>' +
        '<button class="btn btn-ghost" onclick="exportData()">\uD83D\uDCE4 Export (JSON)</button>' +
        '<label class="btn btn-ghost" style="cursor:pointer;">\uD83D\uDCE5 Import (JSON)<input type="file" accept=".json" style="display:none;" onchange="importData(this)"></label>' +
        '</div></div>' +

        '<div class="card">' +
        '<div class="card-header"><div class="card-title">\uD83D\uDCCA Version</div></div>' +
        '<div id="ver-info">Lade...</div></div>';

    loadVersion();
    loadTzInfo();
}

async function discoverAlexaDevs() {
    const btn = document.getElementById('btn-discover');
    const res_div = document.getElementById('alexa-discover-result');
    const sel = document.getElementById('alexa-discover-sel');
    if (!res_div || !sel) return;
    if (btn) { btn.textContent = '\u23F3 Suche...'; btn.disabled = true; }
    try {
        const d = await api('GET', '/api/alexa-discover');
        const devs = d.devices || [];
        // Remove options except placeholder
        while (sel.options.length > 1) sel.remove(1);
        if (devs.length === 0) {
            sel.options[0].text = '-- Keine Ger\u00E4te gefunden (alexa2-Adapter aktiv?) --';
        } else {
            sel.options[0].text = '-- Ger\u00E4t ausw\u00E4hlen (' + devs.length + ' gefunden) --';
            devs.forEach(dev => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify(dev);
                opt.text = dev.name + '  [' + dev.serial + ']';
                sel.appendChild(opt);
            });
        }
        res_div.style.display = 'block';
        // Auto-select if only one
        if (devs.length === 1) sel.selectedIndex = 1;
    } catch(e) {
        alert('Fehler beim Suchen: ' + e.message);
    } finally {
        if (btn) { btn.textContent = '\uD83D\uDD0D Automatisch erkennen'; btn.disabled = false; }
    }
}

function addAlexaFromDiscover() {
    const sel = document.getElementById('alexa-discover-sel');
    if (!sel || !sel.value) { alert('Bitte ein Ger\u00E4t ausw\u00E4hlen.'); return; }
    try {
        const dev = JSON.parse(sel.value);
        // Check not already added
        if (alexaDevs.find(d => d.stateId === dev.stateId)) {
            alert(dev.name + ' ist bereits in der Liste.');
            return;
        }
        alexaDevs.push({ name: dev.name, stateId: dev.stateId });
        saveAlexaDevs();
        document.getElementById('alexa-dev-list').innerHTML = renderAlexaDevList();
        // Reset dropdown
        sel.selectedIndex = 0;
    } catch(e) { alert('Fehler: ' + e.message); }
}

function renderAlexaDevList() {
    if (alexaDevs.length === 0) return '<div style="color:var(--muted);font-size:12px;">Noch keine Ger\u00E4te.</div>';
    return alexaDevs.map((d,i) =>
        '<div class="alexa-chip" style="margin-bottom:5px;">' +
        '<span>\uD83D\uDDE3 <strong>' + esc(d.name) + '</strong></span>' +
        '<span>' + esc(d.stateId) + '</span>' +
        '<button class="btn btn-danger btn-sm" data-idx="' + i + '" onclick="removeAlexaDev(parseInt(this.dataset.idx))">x</button>' +
        '</div>'
    ).join('');
}

function addAlexaDev() {
    const name  = (document.getElementById('new-alexa-name')  || {}).value || '';
    const state = (document.getElementById('new-alexa-state') || {}).value || '';
    if (!name.trim() || !state.trim()) { alert('Bitte Name und State-ID angeben.'); return; }
    alexaDevs.push({ name: name.trim(), stateId: state.trim() });
    saveAlexaDevs();
    document.getElementById('new-alexa-name').value  = '';
    document.getElementById('new-alexa-state').value = '';
    document.getElementById('alexa-dev-list').innerHTML = renderAlexaDevList();
}

function removeAlexaDev(idx) {
    alexaDevs.splice(idx, 1);
    saveAlexaDevs();
    document.getElementById('alexa-dev-list').innerHTML = renderAlexaDevList();
}

async function saveAlexaDevs() {
    try { await api('POST', '/api/alexa', { devices: alexaDevs }); } catch(e) {}
}

// ICS
function renderIcsList() {
    if (icsUrls.length === 0) return '<div style="color:var(--muted);font-size:12px;">Noch keine externen Kalender.</div>';
    return icsUrls.map((u,i) =>
        '<div style="display:flex;align-items:center;gap:8px;background:var(--bg3);border-radius:6px;padding:8px 10px;margin-bottom:5px;font-size:12px;">' +
        '<span style="width:12px;height:12px;border-radius:50%;background:' + esc(u.color||'#a371f7') + ';flex-shrink:0;"></span>' +
        '<strong>' + esc(u.name) + '</strong>' +
        '<span style="color:var(--dim);overflow:hidden;text-overflow:ellipsis;flex:1;">' + esc(u.url.substring(0,60) + (u.url.length > 60 ? '...' : '')) + '</span>' +
        '<button class="btn btn-danger btn-sm" data-idx="' + i + '" onclick="removeIcsUrl(parseInt(this.dataset.idx))">x</button>' +
        '</div>'
    ).join('');
}

async function addIcsUrl() {
    const name  = (document.getElementById('new-ics-name')  || {}).value || '';
    const url   = (document.getElementById('new-ics-url')   || {}).value || '';
    const color = (document.getElementById('new-ics-color') || {}).value || '#a371f7';
    if (!url.trim()) { alert('Bitte URL angeben.'); return; }
    icsUrls.push({ name: name.trim() || 'Kalender', url: url.trim(), color });
    await saveIcsUrls();
    document.getElementById('new-ics-name').value = '';
    document.getElementById('new-ics-url').value  = '';
    document.getElementById('ics-list').innerHTML = renderIcsList();
}

async function removeIcsUrl(idx) {
    icsUrls.splice(idx, 1);
    await saveIcsUrls();
    document.getElementById('ics-list').innerHTML = renderIcsList();
}

async function saveIcsUrls() {
    try {
        await api('POST', '/api/ics-urls', { urls: icsUrls });
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function refreshIcs() {
    try {
        await api('POST', '/api/ics-refresh');
        setTimeout(async () => {
            await loadData();
            renderSystem();
            if (activeTab === 'cal') renderCalendar();
        }, 3000);
        alert('ICS-Kalender werden aktualisiert...');
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function loadVersion() {
    try {
        const d = await api('GET', '/api/version');
        const el = document.getElementById('ver-info');
        if (!el) return;
        const upd = d.latest && d.latest !== d.current;
        el.innerHTML = '<span style="color:var(--muted);">Installiert: </span><strong>' + esc(d.current) + '</strong>' +
            (d.latest ? ' &nbsp;|&nbsp; <span style="color:var(--muted);">GitHub: </span><strong>' + esc(d.latest) + '</strong>' : '') +
            (upd ? ' &nbsp;<span class="badge badge-orange">\u2B06 Update</span>' : ' &nbsp;<span class="badge badge-green">\u2714 Aktuell</span>');
    } catch(e) {}
}

async function triggerDaily() {
    try { await api('POST', '/api/trigger'); await loadData(); refreshCurrentTab(); alert('Tagespr\u00FCfung ausgef\u00FChrt!'); }
    catch(e) { alert('Fehler: ' + e.message); }
}

function exportData() {
    const blob = new Blob([JSON.stringify({ events, birthdays, icsUrls, alexaDevices: alexaDevs }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'kalender-export-' + todayStr() + '.json'; a.click();
}

function importData(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const d = JSON.parse(e.target.result);
            if (d.events)   for (const ev of d.events)   await api('POST', '/api/events',    ev);
            if (d.birthdays) for (const bd of d.birthdays) await api('POST', '/api/birthdays', bd);
            await loadData(); refreshCurrentTab(); alert('Import erfolgreich!');
        } catch(err) { alert('Import-Fehler: ' + err.message); }
    };
    reader.readAsText(file);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); });

// ── Refresh ───────────────────────────────────────────────────────────────────
function refreshCurrentTab() {
    if (activeTab === 'cal')    renderCalendar();
    if (activeTab === 'tasks')  renderTasks();
    if (activeTab === 'bdays')  renderBirthdays();
    if (activeTab === 'system') renderSystem();
    updateHeader({});
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    startClock();
    await loadData();
    renderCalendar();
    document.querySelectorAll('.tab').forEach((t,i) => { if (i === 0) t.classList.add('active'); });
    setInterval(async () => {
        await loadData();
        if (activeTab === 'cal')   renderCalendar();
        if (activeTab === 'tasks') renderTasks();
        if (activeTab === 'bdays') renderBirthdays();
    }, 60000);
}

init();
