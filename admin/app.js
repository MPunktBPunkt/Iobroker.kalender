/* iobroker.kalender — Browser-App v0.4.0 */
'use strict';

// ── Global State ─────────────────────────────────────────────────────────────
const BASE = window.location.origin;
let events         = [];
let birthdays      = [];
let icsEvents      = [];
let icsUrls        = [];
let alexaDevs      = [];
let currentView    = 'month';
let currentDate    = new Date();
let taskFilter     = 'all';
let editEventId    = null;
let editBdayId     = null;
let logPollTimer   = null;
let activeTab      = 'cal';
let editingSegments = [];

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

function occursOnDate(ev, dateString) {
    if (!ev || !ev.date) return false;
    if (ev.date === dateString) return true;
    if (!ev.recurrence || ev.recurrence === 'none') return false;
    const base   = new Date(ev.date + 'T12:00:00');
    const target = new Date(dateString + 'T12:00:00');
    if (target <= base) return false;
    if (ev.recurrenceEnd && target > new Date(ev.recurrenceEnd + 'T23:59:59')) return false;
    if (ev.recurrence === 'daily')   return true;
    if (ev.recurrence === 'weekly')  return Math.round((target - base) / 86400000) % 7 === 0;
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
    return { none:'', daily:'Täglich', weekly:'Wöchentlich', monthly:'Monatlich', yearly:'Jährlich' }[r] || r;
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

function updateHeader(d) {
    const today   = todayStr();
    const evToday = events.filter(e => !e.done && occursOnDate(e, today)).length +
                    icsEvents.filter(e => occursOnDate(e, today)).length;
    document.getElementById('hdr-ev').textContent    = events.length + (icsEvents.length ? '+' + icsEvents.length : '');
    document.getElementById('hdr-today').textContent = evToday;
    document.getElementById('hdr-bd').textContent    = birthdays.length;
    const ver = d && d.version ? 'v' + d.version : '';
    const lc  = d && d.lastCheck ? ' | Prüfung: ' + new Date(d.lastCheck).toLocaleString('de-DE') : '';
    document.getElementById('hdr-sub').textContent = ver + lc;
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
    html += WEEKDAYS_S.map(d => '<div class="cal-day-header">' + d + '</div>').join('');

    for (let i = 0; i < totalCells; i++) {
        const cell = addDays(startDate, i), ds = dateToStr(cell);
        const isToday = ds === today, isOther = cell.getMonth() !== month;
        const dayEvs  = getEventsForDate(ds), dayBds = getBirthdaysForDate(ds);

        const dayNum = isToday
            ? '<span class="cal-today-dot">' + cell.getDate() + '</span>'
            : String(cell.getDate());

        let chips = '';
        dayBds.forEach(b => {
            chips += '<div class="event-chip" style="background:#3d220033;color:#f0883e;border-left:2px solid #f0883e;" ' +
                'data-bid="' + esc(b.id) + '" onclick="event.stopPropagation();openBdayModal(this.dataset.bid)">' +
                '\uD83C\uDF82 ' + esc(b.name) + '</div>';
        });
        dayEvs.slice(0,4).forEach(e => {
            const col = e.color || '#58a6ff';
            const isIcs = e.source === 'ics';
            chips += '<div class="event-chip" style="background:' + col + '22;color:' + col + ';border-left:2px solid ' + col + ';" ' +
                (isIcs ? '' : 'data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)"') + '>' +
                (isIcs ? '\uD83D\uDCC6 ' : (e.triggerTime ? '\u23F0 ' : '')) +
                (e.time ? e.time + ' ' : '') + esc(e.title) + '</div>';
        });
        if (dayEvs.length > 4) chips += '<div class="event-chip" style="background:var(--bg3);color:var(--muted);">+' + (dayEvs.length-4) + ' weitere</div>';

        html += '<div class="cal-cell' + (isOther?' other-month':'') + (isToday?' today':'') + '" ' +
            'data-date="' + ds + '" onclick="calCellClick(this.dataset.date)">' +
            '<div class="cal-day-num">' + dayNum + '</div>' + chips + '</div>';
    }
    return html + '</div>';
}

function renderWeekGrid() {
    const mon = getMonday(currentDate), today = todayStr();
    let html = '<div class="cal-week" style="height:calc(100vh - 190px);overflow-y:auto;">';
    html += '<div class="week-col-header" style="background:var(--bg1);"></div>';
    for (let d = 0; d < 7; d++) {
        const day = addDays(mon, d), ds = dateToStr(day);
        html += '<div class="week-col-header' + (ds===today?' today-col':'') + '">' +
            WEEKDAYS_S[d] + '<br><strong>' + day.getDate() + '</strong></div>';
    }
    for (let h = 0; h < 24; h++) {
        html += '<div class="week-time-label">' + String(h).padStart(2,'0') + ':00</div>';
        for (let d = 0; d < 7; d++) {
            const day = addDays(mon, d), ds = dateToStr(day);
            const slotEvs = getEventsForDate(ds).filter(e => {
                if (e.allDay) return h === 0;
                const t = e.triggerTime || e.time;
                if (!t) return h === 0;
                return parseInt(t.split(':')[0]) === h;
            });
            const chips = slotEvs.map(e => {
                const col = e.color || '#58a6ff';
                return '<div class="week-event" style="background:' + col + '33;color:' + col + ';border-left:2px solid ' + col + ';" ' +
                    (e.source !== 'ics' ? 'data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)"' : '') + '>' +
                    (e.triggerTime ? '\u23F0 ' : '') + esc(e.title) + '</div>';
            }).join('');
            html += '<div class="week-slot" data-date="' + ds + '" data-hour="' + h + '" onclick="calSlotClick(this.dataset.date,this.dataset.hour)">' + chips + '</div>';
        }
    }
    return html + '</div>';
}

function renderDayGrid() {
    const ds = dateToStr(currentDate), today = todayStr(), curHour = new Date().getHours();
    let html = '<div style="height:calc(100vh - 190px);overflow-y:auto;border:1px solid var(--border);border-radius:8px;">';
    for (let h = 0; h < 24; h++) {
        const slotEvs = getEventsForDate(ds).filter(e => {
            if (e.allDay) return h === 0;
            const t = e.triggerTime || e.time;
            if (!t) return h === 0;
            return parseInt(t.split(':')[0]) === h;
        });
        const bdChips = h === 0 ? getBirthdaysForDate(ds).map(b =>
            '<div style="background:#3d220055;color:#f0883e;border-left:3px solid #f0883e;border-radius:3px;padding:6px 8px;margin-bottom:4px;cursor:pointer;" ' +
            'data-bid="' + esc(b.id) + '" onclick="openBdayModal(this.dataset.bid)">\uD83C\uDF82 ' + esc(b.name) + ' hat Geburtstag!</div>'
        ).join('') : '';
        const chips = slotEvs.map(e => {
            const col = e.color || '#58a6ff';
            return '<div style="background:' + col + '33;color:' + col + ';border-left:3px solid ' + col + ';border-radius:3px;padding:6px 8px;margin-bottom:4px;' +
                (e.source !== 'ics' ? 'cursor:pointer;"' : '"') +
                (e.source !== 'ics' ? ' data-eid="' + esc(e.id) + '" onclick="event.stopPropagation();openEventModal(this.dataset.eid)"' : '') + '>' +
                (e.triggerTime ? '<strong>\u23F0 ' + e.triggerTime + '</strong> ' : (e.time ? '<strong>' + e.time + '</strong> ' : '')) +
                esc(e.title) + (e.description ? '<br><small style="opacity:.7;">' + esc(e.description.substring(0,80)) + '</small>' : '') + '</div>';
        }).join('');
        const isNow = ds === today && h === curHour;
        html += '<div style="display:grid;grid-template-columns:48px 1fr;">' +
            '<div style="font-size:10px;color:var(--dim);font-family:var(--mono);padding:6px 4px;border-bottom:1px solid var(--border);background:' + (isNow?'#1a2d4a':'var(--bg1)') + ';">' + String(h).padStart(2,'0') + ':00</div>' +
            '<div style="padding:4px 8px;border-bottom:1px solid var(--border);background:' + (isNow?'#1a2d4a11':'var(--bg2)') + ';cursor:pointer;" ' +
            'data-date="' + ds + '" data-hour="' + h + '" onclick="calSlotClick(this.dataset.date,this.dataset.hour)">' +
            bdChips + chips + '</div></div>';
    }
    return html + '</div>';
}

function calCellClick(ds) { openEventModal(null, ds); }
function calSlotClick(ds, h) { openEventModal(null, ds, h); }
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
    editEventId  = id;
    editingSegments = [];
    const ev     = id ? events.find(e => e.id === id) : null;
    const modal  = document.getElementById('event-modal-inner');
    const ds     = ev ? ev.date : (defaultDate || todayStr());
    const time   = ev ? (ev.time || '') : (defaultHour != null ? String(defaultHour).padStart(2,'0') + ':00' : '');

    if (ev && ev.messageSegments && ev.messageSegments.length > 0) {
        editingSegments = JSON.parse(JSON.stringify(ev.messageSegments));
    }

    const swatches = COLORS.map(c =>
        '<div class="swatch" style="background:' + c + ';" data-color="' + c + '" onclick="pickColor(this.dataset.color)"' +
        ((ev ? ev.color === c : c === '#58a6ff') ? ' class="swatch selected"' : '') + '></div>'
    ).join('');

    const alexaHtml = buildAlexaPickerHtml(ev ? (ev.alexaDatapoints || []) : [], 'ev-alexa');
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
        '<div class="form-row"><label>Wiederholung</label><select id="ev-recurrence">' +
        ['none','daily','weekly','monthly','yearly'].map(r => '<option value="' + r + '"' + (ev && ev.recurrence === r ? ' selected' : '') + '>' +
            (r === 'none' ? 'Keine' : recLabel(r)) + '</option>').join('') +
        '</select></div>' +
        '<div class="form-row"><label>Bis Datum</label><input id="ev-recend" type="date" value="' + esc(ev ? ev.recurrenceEnd : '') + '"></div></div>' +

        // ── TRIGGER TIME ──────────────────────────────────────────────────────
        '<hr class="form-divider">' +
        '<div class="trigger-box">' +
        '<div class="trigger-box-title">\u23F0 Zeit-basierter Ausl\u00F6ser (optional)</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Wenn gesetzt, wird dieser Termin t\u00E4glich um diese Uhrzeit ausgef\u00FChrt (Wiederhol.-Einstellung oben beachten).</div>' +
        '<div class="form-row" style="margin-bottom:0;"><label>Ausl\u00F6ser-Uhrzeit (HH:MM)</label>' +
        '<input id="ev-triggertime" type="time" value="' + esc(ev ? ev.triggerTime : '') + '" style="max-width:160px;"></div>' +
        '</div>' +

        // ── DATAPOINT ACTION ──────────────────────────────────────────────────
        '<hr class="form-divider">' +
        '<div class="form-section">\uD83D\uDD17 ioBroker Datenpunkt-Aktion</div>' +
        '<div class="form-cols">' +
        '<div class="form-row"><label>Datenpunkt setzen (State-ID)</label>' +
        '<input id="ev-dp-id" type="text" placeholder="z.B. pool.0.pump.switch" value="' + esc(ev ? ev.setDatapointId : '') + '"></div>' +
        '<div class="form-row"><label>Wert</label>' +
        '<input id="ev-dp-val" type="text" placeholder="true / false / 1 / 23.5" value="' + esc(ev ? ev.setDatapointValue : '') + '"></div></div>' +
        '<div class="form-row"><label>Typ</label><select id="ev-dp-type">' +
        ['boolean','number','string'].map(t => '<option value="' + t + '"' + (ev && ev.setDatapointType === t ? ' selected' : '') + '>' +
            { boolean: 'Boolean (true/false)', number: 'Zahl', string: 'Text' }[t] + '</option>').join('') +
        '</select></div>' +
        '<div class="form-cols">' +
        '<div class="form-row"><label>Zähler erhöhen (State-ID)</label>' +
        '<input id="ev-ctr-id" type="text" placeholder="z.B. javascript.0.count" value="' + esc(ev ? ev.iobCounterId : '') + '"></div>' +
        '<div class="form-row"><label>Einfacher Datenpunkt (State-ID)</label>' +
        '<input id="ev-iob-id" type="text" placeholder="z.B. javascript.0.flag" value="' + esc(ev ? ev.iobDatapointId : '') + '"></div></div>' +

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
        recurrenceEnd:     document.getElementById('ev-recend').value,
        triggerTime:       document.getElementById('ev-triggertime').value,
        setDatapointId:    document.getElementById('ev-dp-id').value.trim(),
        setDatapointValue: document.getElementById('ev-dp-val').value.trim(),
        setDatapointType:  document.getElementById('ev-dp-type').value,
        iobCounterId:      document.getElementById('ev-ctr-id').value.trim(),
        iobDatapointId:    document.getElementById('ev-iob-id').value.trim(),
        iobDatapointValue: true,
        alexaMessage:      msgBuilderVisible ? '' : (document.getElementById('ev-alexa-msg') ? document.getElementById('ev-alexa-msg').value.trim() : ''),
        messageSegments:   msgBuilderVisible ? JSON.parse(JSON.stringify(editingSegments)) : [],
        alexaDatapoints
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
    if (taskFilter === 'today')   filtered = filtered.filter(e => occursOnDate(e, today));
    if (taskFilter === 'week')    filtered = filtered.filter(e => e.date >= today && e.date <= weekEnd);
    if (taskFilter === 'done')    filtered = filtered.filter(e => e.done);
    if (taskFilter === 'timed')   filtered = filtered.filter(e => e.triggerTime);
    if (taskFilter === 'all')     filtered = filtered.filter(() => true);

    filtered.sort((a,b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.triggerTime && !b.triggerTime) return -1;
        if (!a.triggerTime && b.triggerTime) return 1;
        if (a.triggerTime && b.triggerTime) return a.triggerTime.localeCompare(b.triggerTime);
        return (a.date || '').localeCompare(b.date || '');
    });

    const filters = [['all','Alle'],['today','Heute'],['week','Woche'],['timed','\u23F0 Geplant'],['done','Erledigt']];
    const filterBar = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<div class="view-btns">' +
        filters.map(([k,l]) => '<div class="view-btn' + (taskFilter===k?' active':'') + '" data-f="' + k + '" onclick="setTaskFilter(this.dataset.f)">' + l + '</div>').join('') +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="openEventModal(null)">+ Neu</button>' +
        '<span style="margin-left:auto;color:var(--muted);font-size:12px;">' + filtered.length + ' Eintr\u00E4ge</span>' +
        '</div>';

    if (filtered.length === 0) {
        panel.innerHTML = filterBar + '<div class="empty-state"><div class="icon">\uD83D\uDDD3\uFE0F</div><div>Keine Eintr\u00E4ge</div></div>';
        return;
    }

    const cards = filtered.map(e => {
        const col = e.color || '#58a6ff';
        const hasTrigger = !!e.triggerTime;
        const hasAlexaSegs = e.messageSegments && e.messageSegments.length > 0;
        const hasSetDP = !!e.setDatapointId;
        return '<div class="task-card' + (e.done ? ' done' : '') + '" style="border-left:3px solid ' + (e.done ? 'var(--dim)' : col) + ';">' +
            '<div class="task-check' + (e.done ? ' checked' : '') + '" data-eid="' + e.id + '" onclick="toggleEventDone(this.dataset.eid)">' + (e.done ? '\u2713' : '') + '</div>' +
            '<div class="task-body">' +
            '<div class="task-title">' + (hasTrigger ? '<span style="color:var(--yellow);">\u23F0 ' + e.triggerTime + '</span> ' : '') + esc(e.title) + '</div>' +
            '<div class="task-meta">' +
            (e.date ? '<span class="badge badge-blue">' + fmtDateShort(e.date) + '</span>' : '') +
            (e.recurrence && e.recurrence !== 'none' ? '<span class="badge badge-purple">' + recLabel(e.recurrence) + '</span>' : '') +
            (hasSetDP ? '<span class="badge badge-orange">\uD83D\uDD17 ' + e.setDatapointId.split('.').slice(-1)[0] + '</span>' : '') +
            (hasAlexaSegs ? '<span class="badge badge-blue">\uD83D\uDDE3 Segmente</span>' : '') +
            (e.alexaDatapoints && e.alexaDatapoints.length ? '<span class="badge badge-orange">\uD83D\uDDE3 Alexa</span>' : '') +
            '</div>' +
            (hasSetDP ? '<div style="font-size:11px;color:var(--muted);margin-top:3px;">\uD83D\uDD17 ' + esc(e.setDatapointId) + ' \u2192 ' + esc(e.setDatapointValue) + '</div>' : '') +
            (hasAlexaSegs ? '<div style="font-size:11px;color:var(--muted);margin-top:3px;">\uD83D\uDDE3 ' + e.messageSegments.map(s => s.type === 'text' ? esc(s.value.substring(0,20)) : ('[' + esc(s.stateId) + ']')).join('') + '</div>' : '') +
            '</div>' +
            '<button class="btn btn-ghost btn-sm" data-eid="' + e.id + '" onclick="openEventModal(this.dataset.eid)">\u270F\uFE0F</button>' +
            '</div>';
    }).join('');

    panel.innerHTML = filterBar + cards;
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
    const alexaHtml = buildAlexaPickerHtml(bd ? (bd.alexaDatapoints || []) : [], 'bd-alexa');

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
        alexaDatapoints:  collectAlexaDatapoints('bd-alexa')
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

// ── Alexa Picker ───────────────────────────────────────────────────────────────
function buildAlexaPickerHtml(selected, prefix) {
    let html = '<div class="form-section" style="margin-top:12px;">Alexa Ger\u00E4te ausw\u00E4hlen</div>';
    if (alexaDevs.length === 0) {
        return html + '<div style="font-size:12px;color:var(--muted);">Keine Ger\u00E4te konfiguriert. System-Tab \u2192 Alexa Ger\u00E4te.</div>';
    }
    html += '<div id="' + prefix + '-list" class="alexa-chip-list">';
    alexaDevs.forEach(dev => {
        const checked = selected.includes(dev.stateId);
        html += '<label class="alexa-chip" style="cursor:pointer;">' +
            '<input type="checkbox" data-state="' + esc(dev.stateId) + '" ' + (checked ? 'checked' : '') + ' style="width:auto;margin:0;">' +
            '<span>\uD83D\uDDE3 <strong>' + esc(dev.name) + '</strong></span>' +
            '<span style="font-size:10px;color:var(--dim);">' + esc(dev.stateId) + '</span>' +
            '</label>';
    });
    return html + '</div>';
}

function collectAlexaDatapoints(prefix) {
    const list = document.getElementById(prefix + '-list');
    if (!list) return [];
    return Array.from(list.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.dataset.state);
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

        // Alexa
        '<div class="card">' +
        '<div class="card-header"><div class="card-title">\uD83D\uDDE3 Alexa Ger\u00E4te</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="discoverAlexaDevs()" id="btn-discover">\uD83D\uDD0D Automatisch erkennen</button></div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Liest alle Echo-Devices aus dem alexa2-Adapter. State-Pfad: <code style="background:var(--bg3);padding:2px 6px;border-radius:3px;">...Commands.speak</code></div>' +
        '<div id="alexa-discover-result" style="display:none;margin-bottom:12px;">' +
        '<select id="alexa-discover-sel" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px 10px;font-size:13px;width:100%;">' +
        '<option value="">-- Ger\u00E4t ausw\u00E4hlen --</option>' +
        '</select>' +
        '<button class="btn btn-success btn-sm" onclick="addAlexaFromDiscover()" style="margin-top:6px;">+ Ausgew\u00E4hltes Ger\u00E4t hinzuf\u00FCgen</button>' +
        '</div>' +
        '<div id="alexa-dev-list">' + renderAlexaDevList() + '</div>' +
        '<hr style="border-color:var(--border);margin:12px 0;">' +
        '<div style="font-size:11px;color:var(--dim);margin-bottom:6px;">Manuell hinzuf\u00FCgen:</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<input id="new-alexa-name" type="text" placeholder="Name (z.B. K\u00FCche Echo)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px;flex:1;min-width:120px;">' +
        '<input id="new-alexa-state" type="text" placeholder="State-ID (alexa2.0.Echo-Devices.GXXXXX.Commands.speak)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px;flex:3;min-width:200px;">' +
        '<button class="btn btn-primary btn-sm" onclick="addAlexaDev()">+ Hinzuf\u00FCgen</button>' +
        '</div></div>' +

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
