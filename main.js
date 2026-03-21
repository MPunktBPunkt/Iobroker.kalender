'use strict';
const utils  = require('@iobroker/adapter-core');
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { exec } = require('child_process');

function execCmd(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message).trim()));
            else resolve(stdout.trim());
        });
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

// Timezone-aware time helpers
function localNow(tz) {
    // Returns a Date-like object with hours/minutes/date in the given IANA timezone
    const now = new Date();
    if (!tz || tz === 'UTC') return now;
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).formatToParts(now);
        const get = (t) => parseInt(parts.find(p => p.type === t).value);
        return {
            getFullYear: () => get('year'),
            getMonth:    () => get('month') - 1,
            getDate:     () => get('day'),
            getHours:    () => { const h = get('hour'); return h === 24 ? 0 : h; },
            getMinutes:  () => get('minute'),
            getSeconds:  () => get('second'),
            getFullDate: () => new Date(get('year'), get('month')-1, get('day'))
        };
    } catch(e) {
        return now;  // fallback
    }
}

function todayStr(tz) {
    const t = localNow(tz);
    return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
}

// Day-of-week index: 0=Mon,1=Tue,2=Wed,3=Thu,4=Fri,5=Sat,6=Sun
const DOW_MAP = { mon:0,tue:1,wed:2,thu:3,fri:4,sat:5,sun:6 };
const WEEKDAYS = ['mon','tue','wed','thu','fri'];

function occursOnDate(event, dateString) {
    if (!event || !event.date) return false;
    if (event.date === dateString) return true;
    if (!event.recurrence || event.recurrence === 'none') return false;
    const base   = new Date(event.date + 'T12:00:00');
    const target = new Date(dateString + 'T12:00:00');
    if (target <= base) return false;
    if (event.recurrenceEnd && target > new Date(event.recurrenceEnd + 'T23:59:59')) return false;
    if (event.recurrence === 'daily')   return true;
    if (event.recurrence === 'weekly') {
        // If specific weekdays are set, check day-of-week
        const days = event.recurrenceDays && event.recurrenceDays.length > 0
            ? event.recurrenceDays
            : null;
        if (days) {
            const dow = (target.getDay() + 6) % 7; // Mon=0
            return days.some(d => DOW_MAP[d] === dow);
        }
        return Math.round((target - base) / 86400000) % 7 === 0;
    }
    if (event.recurrence === 'workdays') {
        const dow = (target.getDay() + 6) % 7;
        return dow >= 0 && dow <= 4; // Mon-Fri
    }
    if (event.recurrence === 'monthly') return base.getDate() === target.getDate();
    if (event.recurrence === 'yearly')  return base.getMonth() === target.getMonth() && base.getDate() === target.getDate();
    return false;
}

function birthdayToday(bday) {
    if (!bday || !bday.date) return false;
    const today = new Date();
    const d = new Date(bday.date + 'T12:00:00');
    return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

function birthdayDaysUntil(bday) {
    if (!bday || !bday.date) return 999;
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(bday.date + 'T12:00:00');
    let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next.setFullYear(next.getFullYear() + 1);
    return Math.round((next - today) / 86400000);
}

// ── Adapter ───────────────────────────────────────────────────────────────────

class KalenderAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'kalender' });
        this.events          = [];
        this.birthdays       = [];
        this.icsEvents       = [];
        this.icsUrls         = [];
        this.logs            = [];
        this.httpServer      = null;
        this.dailyTimer      = null;
        this.minuteInterval  = null;
        this.icsRefreshTimer = null;
        this.pack            = {};
        this.alexaDevices    = [];
        this.on('ready',  this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('message',this.onMessage.bind(this));
    }

    // ── Logging ────────────────────────────────────────────────────────────

    _log(level, cat, msg) {
        const entry = { ts: Date.now(), level, cat, msg };
        this.logs.push(entry);
        const max = (this.config && this.config.logBuffer) || 500;
        if (this.logs.length > max) this.logs.shift();
        try { if (this.log && this.log[level]) this.log[level]('[' + cat + '] ' + msg); } catch(e) {}
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    async onReady() {
        try {
        try { this.pack = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')); }
        catch(e) { this.pack = { version: '0.5.8' }; }

        this.alexaDevices = [];
        try { const raw = this.config && this.config.alexaDevices; if (raw) this.alexaDevices = JSON.parse(raw); } catch(e) {}

        // Zeitzone aus ioBroker system.config lesen (Fallback: Admin-Konfiguration, dann Europe/Berlin)
        try {
            const sysConf = await this.getForeignObjectAsync('system.config');
            const sysTz   = sysConf && sysConf.common && sysConf.common.timezone;
            const cfgTz   = this.config && this.config.timezone;
            this.tz = sysTz || cfgTz || 'Europe/Berlin';
            this._log('info', 'SYSTEM', 'Zeitzone: ' + this.tz + (sysTz ? ' (aus system.config)' : ' (aus Adapter-Config)'));
        } catch(e) {
            this.tz = (this.config && this.config.timezone) || 'Europe/Berlin';
            this._log('warn', 'SYSTEM', 'system.config nicht lesbar, Fallback: ' + this.tz);
        }
        await this._loadData();

        const port = (this.config && this.config.webPort) || 8095;
        this._startServer(port);
        this._scheduleDaily();
        this._startMinuteTimer();

        if (this.icsUrls.length > 0) {
            setTimeout(() => this._fetchAllIcs(), 5000);
            this.icsRefreshTimer = setInterval(() => this._fetchAllIcs(), 3600000);
        }

        setTimeout(() => this._dailyCheck(), 3000);

        await this.setStateAsync('info.connection', true, true).catch(() => {});
        this._log('info', 'SYSTEM', 'Adapter v' + this.pack.version + ' gestartet, Port ' + port);
        } catch(e) {
            this.log && this.log.error && this.log.error('onReady Fehler: ' + e.message);
        }
    }

    async onUnload(callback) {
        try {
            if (this.httpServer)      this.httpServer.close();
            if (this.dailyTimer)      clearTimeout(this.dailyTimer);
            if (this.minuteInterval)  clearInterval(this.minuteInterval);
            if (this.icsRefreshTimer) clearInterval(this.icsRefreshTimer);
        } catch(e) {}
        callback();
    }

    onMessage(obj) {
        if (!obj || !obj.command) return;
        if (obj.command === 'ping' && obj.callback) this.sendTo(obj.from, obj.command, { result: 'pong' }, obj.callback);
    }

    async _loadData() {
        try { const s = await this.getStateAsync('data.events');    this.events    = s && s.val ? JSON.parse(s.val) : []; } catch(e) { this.events    = []; }
        try { const s = await this.getStateAsync('data.birthdays'); this.birthdays = s && s.val ? JSON.parse(s.val) : []; } catch(e) { this.birthdays = []; }
        try { const s = await this.getStateAsync('data.icsUrls');   this.icsUrls   = s && s.val ? JSON.parse(s.val) : []; } catch(e) { this.icsUrls   = []; }
        this._log('info', 'SYSTEM', 'Daten geladen: ' + this.events.length + ' Termine, ' + this.birthdays.length + ' Geburtstage, ' + this.icsUrls.length + ' ICS-Kalender');
    }

    async _saveEvents()    { await this.setStateAsync('data.events',    JSON.stringify(this.events),    true).catch(() => {}); }
    async _saveBirthdays() { await this.setStateAsync('data.birthdays', JSON.stringify(this.birthdays), true).catch(() => {}); }
    async _saveIcsUrls()   { await this.setStateAsync('data.icsUrls',   JSON.stringify(this.icsUrls),   true).catch(() => {}); }

    // ── Daily Check ─────────────────────────────────────────────────────────

    _scheduleDaily() {
        const now   = localNow(this.tz);
        const msNow = Date.now();
        // Calculate ms until 00:01 local time
        const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 1, 0);
        const nextLocal = new Date(todayBase.getTime() + 24 * 3600000);
        const msUntil   = nextLocal - msNow;
        this.dailyTimer = setTimeout(() => { this._dailyCheck(); this._scheduleDaily(); }, msUntil > 0 ? msUntil : 60000);
    }

    async _dailyCheck() {
        const today = todayStr(this.tz);
        this._log('info', 'CHECK', 'Tagesprüfung für ' + today);

        const eventsToday = this.events.filter(e => !e.done && occursOnDate(e, today));
        await this.setStateAsync('today.eventsToday', JSON.stringify(eventsToday), true).catch(() => {});

        for (const ev of eventsToday) {
            // Classic ioBroker state / counter
            if (ev.iobDatapointId) {
                try { await this.setForeignStateAsync(ev.iobDatapointId, ev.iobDatapointValue || true, false); } catch(e) {}
            }
            if (ev.iobCounterId) {
                try {
                    const cur = await this.getForeignStateAsync(ev.iobCounterId);
                    await this.setForeignStateAsync(ev.iobCounterId, (cur && typeof cur.val === 'number' ? cur.val + 1 : 1), false);
                } catch(e) {}
            }
            // Alexa only if no triggerTime (time-triggered is handled by minute timer)
            if (!ev.triggerTime && !ev.time && ev.alexaDatapoints && ev.alexaDatapoints.length > 0) {
                const msg = await this._resolveMessage(ev);
                if (msg) await this._triggerAlexa(ev.alexaDatapoints, msg, ev.alexaVolumes);
            }
        }

        const bdToday = this.birthdays.filter(b => birthdayToday(b));
        const bdSoon  = this.birthdays.filter(b => {
            const d = birthdayDaysUntil(b);
            return d > 0 && d <= (b.notifyDaysBefore || 1);
        });
        await this.setStateAsync('today.birthdaysToday', JSON.stringify(bdToday), true).catch(() => {});

        for (const bd of bdToday) {
            const age = new Date().getFullYear() - new Date(bd.date + 'T12:00:00').getFullYear();
            const msg = (bd.alexaMessage || 'Heute hat {name} Geburtstag! Er wird {age} Jahre alt.')
                .replace('{age}', age).replace('{name}', bd.name);
            if (bd.alexaDatapoints && bd.alexaDatapoints.length > 0) await this._triggerAlexa(bd.alexaDatapoints, msg, bd.alexaVolumes);
        }
        for (const bd of bdSoon) {
            const days = birthdayDaysUntil(bd);
            const age  = new Date().getFullYear() - new Date(bd.date + 'T12:00:00').getFullYear() + 1;
            const msg  = 'In ' + days + ' Tag' + (days === 1 ? '' : 'en') + ' hat ' + bd.name + ' Geburtstag. Er wird ' + age + ' Jahre alt.';
            if (bd.alexaDatapoints && bd.alexaDatapoints.length > 0) await this._triggerAlexa(bd.alexaDatapoints, msg, bd.alexaVolumes);
        }

        await this.setStateAsync('info.lastCheck', new Date().toISOString(), true).catch(() => {});
        this._log('info', 'CHECK', eventsToday.length + ' Termine, ' + bdToday.length + ' Geburtstage heute');
    }

    // ── Minute-precise Timer ──────────────────────────────────────────────────

    _startMinuteTimer() {
        const now = new Date();
        const msToNext = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 300;
        setTimeout(() => {
            this._minuteTick();
            this.minuteInterval = setInterval(() => this._minuteTick(), 60000);
        }, msToNext);
    }

    async _minuteTick() {
        const now   = localNow(this.tz);
        const hhmm  = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
        const today = todayStr(this.tz);

        for (const ev of this.events) {
            if (ev.done) continue;
            // Effektive Trigger-Zeit: triggerTime hat Vorrang, sonst time (Kalenderzeit = Trigger)
            const tTime = ev.triggerTime || ev.time || '';
            if (!tTime || tTime !== hhmm) continue;
            if (!occursOnDate(ev, today)) continue;
            await this._executeTimedEvent(ev).catch(e => this._log('warn', 'TRIGGER', e.message));
        }

        // ── Erinnerungen prüfen ──────────────────────────────────────────────
        for (const ev of this.events) {
            if (ev.done || !ev.reminderBefore || !ev.time) continue;
            if (!occursOnDate(ev, today)) continue;
            const mins = this._reminderMinutes(ev.reminderBefore);
            if (!mins) continue;
            // Berechne Erinnerungszeit = ev.time - mins
            const [h, m] = ev.time.split(':').map(Number);
            const totalMins = h * 60 + m - mins;
            if (totalMins < 0) continue;
            const rh = String(Math.floor(totalMins / 60)).padStart(2,'0');
            const rm = String(totalMins % 60).padStart(2,'0');
            if ((rh + ':' + rm) !== hhmm) continue;
            const label = this._reminderLabel(ev.reminderBefore);
            const msg   = label + ' vor ' + ev.title + (ev.time ? ' um ' + ev.time + ' Uhr' : '');
            this._log('info', 'TRIGGER', 'Erinnerung: ' + msg);
            if (ev.alexaDatapoints && ev.alexaDatapoints.length > 0) {
                await this._triggerAlexa(ev.alexaDatapoints, msg, ev.alexaVolumes);
            }
        }
    }

    _reminderMinutes(rb) {
        if (!rb || !rb.value) return 0;
        const v = parseInt(rb.value);
        if (rb.unit === 'hours') return v * 60;
        if (rb.unit === 'days')  return v * 1440;
        return v; // minutes
    }

    _reminderLabel(rb) {
        if (!rb || !rb.value) return '';
        const v = rb.value;
        if (rb.unit === 'hours')   return v + ' Stunde' + (v > 1 ? 'n' : '');
        if (rb.unit === 'days')    return v + ' Tag' + (v > 1 ? 'e' : '');
        return v + ' Minute' + (v > 1 ? 'n' : '');
    }

    // ── Timed Event Execution ─────────────────────────────────────────────────

    async _executeTimedEvent(ev) {
        this._log('info', 'TRIGGER', 'Zeit-Trigger ' + ev.triggerTime + ': ' + ev.title);

        // Datenpunkt-Aktionen (neues dpActions-Array)
        const actions = (ev.dpActions && ev.dpActions.length > 0) ? ev.dpActions :
            (ev.setDatapointId ? [{ id: ev.setDatapointId, value: ev.setDatapointValue, type: ev.setDatapointType || 'boolean' }] : []);
        for (const action of actions) {
            if (!action.id) continue;
            try {
                let val = action.value;
                if (action.type === 'boolean')     val = (val === 'true' || val === true);
                else if (action.type === 'number') val = parseFloat(val);
                await this.setForeignStateAsync(action.id, val, false);
                this._log('info', 'TRIGGER', 'Gesetzt: ' + action.id + ' = ' + String(val));
            } catch(e) {
                this._log('warn', 'TRIGGER', 'Fehler ' + action.id + ': ' + e.message);
            }
        }

        // Classic ioBroker state
        if (ev.iobDatapointId) {
            try { await this.setForeignStateAsync(ev.iobDatapointId, ev.iobDatapointValue || true, false); } catch(e) {}
        }
        if (ev.iobCounterId) {
            try {
                const cur = await this.getForeignStateAsync(ev.iobCounterId);
                await this.setForeignStateAsync(ev.iobCounterId, (cur && typeof cur.val === 'number' ? cur.val + 1 : 1), false);
            } catch(e) {}
        }

        // Alexa Nachricht
        if (ev.alexaDatapoints && ev.alexaDatapoints.length > 0) {
            const msg = await this._resolveMessage(ev);
            if (msg) await this._triggerAlexa(ev.alexaDatapoints, msg);
        }
    }

    // ── Message Building ──────────────────────────────────────────────────────

    async _resolveMessage(ev) {
        if (ev.messageSegments && ev.messageSegments.length > 0) {
            return await this._buildMessage(ev.messageSegments);
        }
        return ev.alexaMessage || '';
    }

    async _buildMessage(segments) {
        let msg = '';
        for (const seg of (segments || [])) {
            if (seg.type === 'text') {
                msg += seg.value || '';
            } else if (seg.type === 'datapoint' && seg.stateId) {
                try {
                    const st  = await this.getForeignStateAsync(seg.stateId);
                    const raw = (st != null && st.val != null) ? String(st.val) : '?';
                    msg += (seg.prefix || '') + raw + (seg.suffix || '');
                } catch(e) {
                    this._log('warn', 'TRIGGER', 'Datenpunkt nicht lesbar: ' + seg.stateId);
                    msg += (seg.prefix || '') + '?' + (seg.suffix || '');
                }
            }
        }
        return msg.trim();
    }

    async _triggerAlexa(datapoints, message, volumes) {
        // volumes = { [stateId]: number } — Lautstärke pro Gerät (aus Event-Konfiguration)
        for (const sid of datapoints) {
            try {
                // Lautstärke: aus Event-volumes-Map, Fallback: alexaDevices-globale Config
                const devCfg     = this.alexaDevices.find(d => d.stateId === sid);
                const volFromEvt = (volumes && volumes[sid] != null) ? parseInt(volumes[sid]) : NaN;
                const volFromDev = (devCfg && devCfg.volume != null && devCfg.volume !== '') ? parseInt(devCfg.volume) : NaN;
                const vol        = !isNaN(volFromEvt) ? volFromEvt : volFromDev;
                if (!isNaN(vol) && vol >= 0 && vol <= 100) {
                    const volStateId = sid.replace('.Commands.speak', '.Commands.volume');
                    try {
                        await this.setForeignStateAsync(volStateId, vol, false);
                        this._log('info', 'ALEXA', 'Volume: ' + volStateId + ' = ' + vol + '%');
                        await new Promise(r => setTimeout(r, 400));
                    } catch(ve) {
                        this._log('warn', 'ALEXA', 'Volume-Fehler: ' + ve.message);
                    }
                }
                await this.setForeignStateAsync(sid, message, false);
                this._log('info', 'ALEXA', sid + ': ' + String(message).substring(0, 100));
            } catch(e) {
                this._log('warn', 'ALEXA', 'Fehler ' + sid + ': ' + e.message);
            }
        }
    }

    // ── ICS Calendar ──────────────────────────────────────────────────────────

    async _fetchAllIcs() {
        this.icsEvents = [];
        for (const icsUrl of this.icsUrls) {
            if (!icsUrl.url) continue;
            try {
                const evts = await this._fetchIcs(icsUrl);
                this.icsEvents.push(...evts);
                this._log('info', 'ICS', 'Geladen: ' + (icsUrl.name || icsUrl.url) + ' (' + evts.length + ' Einträge)');
            } catch(e) {
                this._log('warn', 'ICS', 'Fehler ' + (icsUrl.name || icsUrl.url) + ': ' + e.message);
            }
        }
        this._log('info', 'ICS', 'Gesamt: ' + this.icsEvents.length + ' ICS-Einträge');
    }

    _fetchIcs(icsUrl, depth) {
        if ((depth || 0) > 3) return Promise.reject(new Error('Zu viele Weiterleitungen'));
        return new Promise((resolve, reject) => {
            const mod  = icsUrl.url.startsWith('https') ? https : http;
            const opts = { timeout: 15000, headers: { 'User-Agent': 'ioBroker.kalender/0.4.0', 'Accept': 'text/calendar' } };
            const req  = mod.get(icsUrl.url, opts, resp => {
                if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                    return this._fetchIcs({ ...icsUrl, url: resp.headers.location }, (depth || 0) + 1).then(resolve).catch(reject);
                }
                if (resp.statusCode !== 200) { reject(new Error('HTTP ' + resp.statusCode)); return; }
                let data = '';
                resp.setEncoding('utf8');
                resp.on('data', c => data += c);
                resp.on('end', () => resolve(this._parseIcs(data, icsUrl.name, icsUrl.color || '#a371f7')));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }

    _parseIcs(text, sourceName, color) {
        const events = [];
        // Unfold MIME-folded continuation lines
        text = text.replace(/\r\n([ \t])/g, '').replace(/\n([ \t])/g, '');
        const blocks = text.split('BEGIN:VEVENT').slice(1);

        for (const block of blocks) {
            const ev = {
                id:         'ics_' + genId(),
                source:     'ics',
                sourceName: sourceName || 'ICS-Kalender',
                color:      color || '#a371f7',
                done:       false,
                recurrence: 'none'
            };
            const lines = block.split(/\r?\n/);
            for (const line of lines) {
                if (line.startsWith('END:VEVENT')) break;
                const ci = line.indexOf(':');
                if (ci < 0) continue;
                const key = line.substring(0, ci).split(';')[0].toUpperCase();
                const val = line.substring(ci + 1).trim()
                    .replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
                if (key === 'SUMMARY')     ev.title       = val;
                if (key === 'DESCRIPTION') ev.description = val.substring(0, 200);
                if (key === 'LOCATION')    ev.location    = val;
                if (key === 'DTSTART')     ev.date        = this._parseIcsDate(val);
                if (key === 'DTEND')       ev.endDate     = this._parseIcsDate(val);
                if (key === 'RRULE') {
                    const parts = {};
                    val.split(';').forEach(p => {
                        const eq = p.indexOf('=');
                        if (eq > 0) parts[p.substring(0,eq)] = p.substring(eq+1);
                    });
                    const freqMap = { DAILY:'daily', WEEKLY:'weekly', MONTHLY:'monthly', YEARLY:'yearly' };
                    if (parts.FREQ && freqMap[parts.FREQ]) ev.recurrence = freqMap[parts.FREQ];
                    if (parts.UNTIL) ev.recurrenceEnd = this._parseIcsDate(parts.UNTIL);
                }
            }
            if (ev.title && ev.date) events.push(ev);
        }
        return events;
    }

    _parseIcsDate(val) {
        const s = (val || '').split('T')[0].replace(/\D/g, '');
        if (s.length < 8) return null;
        return s.substr(0,4) + '-' + s.substr(4,2) + '-' + s.substr(6,2);
    }

    // ── HTTP Server ───────────────────────────────────────────────────────────

    _startServer(port) {
        this.httpServer = http.createServer((req, res) => {
            this._route(req, res).catch(e => {
                res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
            });
        });
        this.httpServer.on('error', e => {
            this._log('error', 'SERVER', e.code === 'EADDRINUSE' ? 'Port ' + port + ' belegt!' : e.message);
        });
        this.httpServer.listen(port, () => {
            this._log('info', 'SERVER', 'Web-UI auf Port ' + port);
        });
    }

    async _readBody(req) {
        return new Promise((res, rej) => {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
            req.on('error', rej);
        });
    }

    async _route(req, res) {
        const parts  = req.url.split('?');
        const url    = parts[0];
        const query  = Object.fromEntries(new URLSearchParams(parts[1] || ''));
        const method = req.method;

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const json = (data, code) => {
            res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        };

        // ── Static ──
        if (url === '/' || url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this._buildHtml());
            return;
        }
        if (url === '/app.js') {
            try {
                const js = fs.readFileSync(path.join(__dirname, 'admin', 'app.js'), 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
                res.end(js);
            } catch(e) { res.writeHead(404); res.end('app.js not found'); }
            return;
        }

        // ── Core API ──
        if (url === '/api/ping') { json({ ok: true, ts: Date.now() }); return; }

        if (url === '/api/data') {
            const lastCheck = await this.getStateAsync('info.lastCheck').catch(() => null);
            json({
                events:       this.events,
                birthdays:    this.birthdays,
                icsEvents:    this.icsEvents,
                icsUrls:      this.icsUrls,
                alexaDevices: this.alexaDevices,
                version:      this.pack.version,
                timezone:     this.tz || 'Europe/Berlin',
                lastCheck:    lastCheck ? lastCheck.val || '' : ''
            });
            return;
        }

        if (url === '/api/logs') { json(this.logs.slice(-150).reverse()); return; }

        if (url === '/api/version') {
            let ghVersion = null;
            try {
                ghVersion = await new Promise((resolve) => {
                    const r = https.get({ hostname: 'api.github.com', path: '/repos/MPunktBPunkt/iobroker.kalender/releases/latest', headers: { 'User-Agent': 'ioBroker' }, timeout: 5000 }, resp => {
                        let d = '';
                        resp.on('data', c => d += c);
                        resp.on('end', () => { try { resolve(JSON.parse(d).tag_name || null); } catch(e) { resolve(null); } });
                    });
                    r.on('error', () => resolve(null));
                });
            } catch(e) {}
            json({ current: this.pack.version, latest: ghVersion });
            return;
        }

        if (url === '/api/trigger' && method === 'POST') {
            this._dailyCheck().catch(e => this._log('warn', 'CHECK', e.message));
            json({ ok: true });
            return;
        }

        // ── Foreign State Read (message preview) ──
        if (url === '/api/foreign-state' && method === 'GET') {
            if (!query.id) { json({ error: 'id required' }, 400); return; }
            try {
                const st = await this.getForeignStateAsync(query.id);
                json({ id: query.id, val: st ? st.val : null, ts: st ? st.ts : null, ok: true });
            } catch(e) {
                json({ id: query.id, val: null, error: e.message, ok: false });
            }
            return;
        }

        // ── Events CRUD ──
        if (url === '/api/events' && method === 'GET')  { json(this.events); return; }
        if (url === '/api/events' && method === 'POST') {
            const body = JSON.parse(await this._readBody(req));
            const ev   = { id: genId(), done: false, doneDate: null, type: 'event', recurrence: 'none', color: '#58a6ff', ...body };
            this.events.push(ev);
            await this._saveEvents();
            this._log('info', 'EVENT', 'Neu: ' + ev.title);
            json(ev);
            return;
        }
        if (url.startsWith('/api/events/') && method === 'PUT') {
            const id  = url.split('/')[3];
            const body = JSON.parse(await this._readBody(req));
            const idx  = this.events.findIndex(e => e.id === id);
            if (idx === -1) { json({ error: 'not found' }, 404); return; }
            this.events[idx] = { ...this.events[idx], ...body };
            await this._saveEvents();
            json(this.events[idx]);
            return;
        }
        if (url.startsWith('/api/events/') && method === 'DELETE') {
            const id = url.split('/')[3];
            this.events = this.events.filter(e => e.id !== id);
            await this._saveEvents();
            json({ ok: true });
            return;
        }

        // ── Birthdays CRUD ──
        if (url === '/api/birthdays' && method === 'GET')  { json(this.birthdays); return; }
        if (url === '/api/birthdays' && method === 'POST') {
            const body = JSON.parse(await this._readBody(req));
            const bd   = { id: genId(), notifyDaysBefore: 1, alexaDatapoints: [], alexaMessage: '', ...body };
            this.birthdays.push(bd);
            await this._saveBirthdays();
            this._log('info', 'BIRTHDAY', 'Neu: ' + bd.name);
            json(bd);
            return;
        }
        if (url.startsWith('/api/birthdays/') && method === 'PUT') {
            const id  = url.split('/')[3];
            const body = JSON.parse(await this._readBody(req));
            const idx  = this.birthdays.findIndex(b => b.id === id);
            if (idx === -1) { json({ error: 'not found' }, 404); return; }
            this.birthdays[idx] = { ...this.birthdays[idx], ...body };
            await this._saveBirthdays();
            json(this.birthdays[idx]);
            return;
        }
        if (url.startsWith('/api/birthdays/') && method === 'DELETE') {
            const id = url.split('/')[3];
            this.birthdays = this.birthdays.filter(b => b.id !== id);
            await this._saveBirthdays();
            json({ ok: true });
            return;
        }

        // ── ICS Calendar Management ──
        if (url === '/api/ics-urls' && method === 'GET')  { json(this.icsUrls); return; }
        if (url === '/api/ics-urls' && method === 'POST') {
            const body = JSON.parse(await this._readBody(req));
            this.icsUrls = body.urls || [];
            await this._saveIcsUrls();
            if (this.icsRefreshTimer) clearInterval(this.icsRefreshTimer);
            if (this.icsUrls.length > 0) {
                this._fetchAllIcs();
                this.icsRefreshTimer = setInterval(() => this._fetchAllIcs(), 3600000);
            } else {
                this.icsEvents = [];
            }
            json({ ok: true, count: this.icsUrls.length });
            return;
        }
        if (url === '/api/ics-refresh' && method === 'POST') {
            this._fetchAllIcs().catch(() => {});
            json({ ok: true, message: 'ICS-Kalender werden geladen...' });
            return;
        }
        if (url === '/api/ics-events' && method === 'GET') { json(this.icsEvents); return; }

        // ── Alexa Config ──
        if (url === '/api/alexa' && method === 'POST') {
            const body = JSON.parse(await this._readBody(req));
            this.alexaDevices = body.devices || [];
            this._log('info', 'ALEXA', 'Ger\u00E4te aktualisiert: ' + this.alexaDevices.length);
            json({ ok: true });
            return;
        }

        // ── Alexa Auto-Discover ──
        if (url === '/api/alexa-discover' && method === 'GET') {
            try {
                const objs = await this.getForeignObjectsAsync('alexa2.0.Echo-Devices.*', 'device');
                const devices = [];
                for (const id of Object.keys(objs || {})) {
                    const obj = objs[id];
                    if (!obj || !obj.common) continue;
                    // id: alexa2.0.Echo-Devices.G091AA10135600WP
                    const parts = id.split('.');
                    if (parts.length !== 4) continue;
                    const serial = parts[3];
                    if (!serial || serial.length < 8) continue;
                    const name = obj.common.name ? String(obj.common.name) : serial;
                    const stateId       = 'alexa2.0.Echo-Devices.' + serial + '.Commands.speak';
                    const volumeStateId = 'alexa2.0.Echo-Devices.' + serial + '.Commands.volume';
                    devices.push({ name, serial, stateId, volumeStateId });
                }
                devices.sort((a,b) => a.name.localeCompare(b.name));
                this._log('info', 'ALEXA', 'Discover: ' + devices.length + ' Ger\u00E4te');
                json({ devices });
            } catch(e) {
                this._log('warn', 'ALEXA', 'Discover-Fehler: ' + e.message);
                json({ devices: [], error: e.message });
            }
            return;
        }

        // ── Trigger single event immediately ──
        if (url === '/api/trigger-event' && method === 'POST') {
            try {
                const body = JSON.parse(await this._readBody(req));
                const ev   = this.events.find(e => e.id === body.id);
                if (!ev) { json({ error: 'event not found' }, 404); return; }
                this._log('info', 'TRIGGER', 'Manuell: ' + ev.title);
                this._executeTimedEvent(ev).catch(e => this._log('warn', 'TRIGGER', e.message));
                json({ ok: true, title: ev.title });
            } catch(e) {
                json({ error: e.message }, 400);
            }
            return;
        }

        // ── Object Browser ──
        if (url === '/api/objects-search' && method === 'GET') {
            const q = (query.q || '').trim();
            if (!q || q.length < 2) { json({ objects: [] }); return; }
            try {
                // Search by pattern — add wildcard
                const pattern = q.endsWith('*') ? q : q + '*';
                const objs = await this.getForeignObjectsAsync(pattern, 'state');
                const result = [];
                for (const [id, obj] of Object.entries(objs || {})) {
                    if (result.length >= 30) break;
                    const t = obj && obj.common ? (obj.common.type || 'mixed') : 'mixed';
                    const n = obj && obj.common && obj.common.name ? 
                        (typeof obj.common.name === 'object' ? (obj.common.name.de || obj.common.name.en || id) : obj.common.name) : id;
                    const unit = obj && obj.common && obj.common.unit ? obj.common.unit : '';
                    result.push({ id, type: t, name: String(n), unit });
                }
                result.sort((a,b) => a.id.localeCompare(b.id));
                json({ objects: result });
            } catch(e) {
                json({ objects: [], error: e.message });
            }
            return;
        }

        if (url === '/api/object-info' && method === 'GET') {
            if (!query.id) { json({ error: 'id required' }, 400); return; }
            try {
                const obj = await this.getForeignObjectAsync(query.id);
                if (!obj) { json({ found: false }); return; }
                const t    = obj.common ? (obj.common.type || 'mixed') : 'mixed';
                const name = obj.common && obj.common.name ?
                    (typeof obj.common.name === 'object' ? (obj.common.name.de || obj.common.name.en || query.id) : obj.common.name) : query.id;
                const unit = obj.common && obj.common.unit ? obj.common.unit : '';
                const states = obj.common && obj.common.states ? obj.common.states : null;
                const min    = obj.common && obj.common.min != null ? obj.common.min : null;
                const max    = obj.common && obj.common.max != null ? obj.common.max : null;
                const st = await this.getForeignStateAsync(query.id).catch(() => null);
                json({ found: true, id: query.id, type: t, name: String(name), unit, states, min, max, currentVal: st ? st.val : null });
            } catch(e) {
                json({ found: false, error: e.message });
            }
            return;
        }

        // ── Timezone Info ──
        if (url === '/api/timezone-info' && method === 'GET') {
            try {
                // Linux timezone
                let linuxTz  = 'unknown', linuxTime = '', ntpSync = false;
                try {
                    const tdctl = await execCmd('timedatectl status');
                    const tzM   = tdctl.match(/Time zone:\s*([^\s(]+)/);
                    const ntpM  = tdctl.match(/NTP service:\s*(active|inactive|running)/i) ||
                                  tdctl.match(/Network time on:\s*(yes|no)/i) ||
                                  tdctl.match(/systemd-timesyncd\.service.*active/i);
                    if (tzM)  linuxTz  = tzM[1];
                    if (ntpM) ntpSync  = /yes|active|running/i.test(ntpM[1] || ntpM[0]);
                    linuxTime = await execCmd('date "+%Y-%m-%d %H:%M:%S %Z"');
                } catch(e) {
                    try { linuxTz = (await execCmd('cat /etc/timezone')).trim(); } catch(e2) {}
                    try { linuxTime = await execCmd('date'); } catch(e3) {}
                }
                json({ linuxTz, linuxTime, ntpSync, iobTz: this.tz || 'unknown' });
            } catch(e) {
                json({ error: e.message, linuxTz: 'error', linuxTime: '', ntpSync: false, iobTz: this.tz || '' });
            }
            return;
        }

        // ── Timezone Sync (Linux → ioBroker tz) ──
        if (url === '/api/timezone-sync' && method === 'POST') {
            if (!this.tz) { json({ error: 'ioBroker-Zeitzone unbekannt' }, 400); return; }
            try {
                const out = await execCmd('sudo timedatectl set-timezone ' + this.tz);
                this._log('info', 'SYSTEM', 'Linux-Zeitzone gesetzt: ' + this.tz);
                json({ ok: true, tz: this.tz, output: out || 'Zeitzone gesetzt.' });
            } catch(e) {
                this._log('warn', 'SYSTEM', 'Zeitzone setzen fehlgeschlagen: ' + e.message);
                json({ ok: false, error: e.message + '\nTipp: sudo-Rechte prüfen (timedatectl)' });
            }
            return;
        }

        // ── NTP Sync ──
        if (url === '/api/ntp-sync' && method === 'POST') {
            try {
                await execCmd('sudo timedatectl set-ntp true');
                // Force immediate sync if timedatectl supports it
                try { await execCmd('sudo timedatectl set-ntp false && sudo timedatectl set-ntp true'); } catch(e2) {}
                const out = await execCmd('timedatectl status');
                this._log('info', 'SYSTEM', 'NTP-Sync aktiviert');
                json({ ok: true, output: out.split('\n').slice(0,4).join('\n') });
            } catch(e) {
                json({ ok: false, error: e.message });
            }
            return;
        }

        // ── Adapter/Instance list for DP picker ──
        if (url === '/api/adapter-instances' && method === 'GET') {
            try {
                const objs = await this.getForeignObjectsAsync('system.adapter.*', 'instance');
                const instances = [];
                for (const id of Object.keys(objs || {})) {
                    // id = system.adapter.freeair100.0
                    const parts = id.split('.');
                    if (parts.length < 4) continue;
                    const name = parts[2] + '.' + parts[3];  // freeair100.0
                    if (!instances.includes(name)) instances.push(name);
                }
                instances.sort();
                json({ instances });
            } catch(e) { json({ instances: [], error: e.message }); }
            return;
        }

        if (url === '/api/instance-states' && method === 'GET') {
            const inst = query.instance; // e.g. freeair100.0
            if (!inst) { json({ states: [] }); return; }
            try {
                const objs = await this.getForeignObjectsAsync(inst + '.*', 'state');
                const states = [];
                for (const [id, obj] of Object.entries(objs || {})) {
                    if (!obj || !obj.common) continue;
                    const shortId = id.slice(inst.length + 1); // strip "freeair100.0."
                    const type  = obj.common.type  || 'mixed';
                    const nameRaw = obj.common.name;
                    const name  = typeof nameRaw === 'object' ? (nameRaw.de || nameRaw.en || shortId) : (nameRaw || shortId);
                    const unit  = obj.common.unit || '';
                    const write = obj.common.write !== false;
                    states.push({ id, shortId, type, name: String(name), unit, write });
                }
                states.sort((a,b) => a.shortId.localeCompare(b.shortId));
                json({ states });
            } catch(e) { json({ states: [], error: e.message }); }
            return;
        }

        res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
    }

    // ── HTML Shell ────────────────────────────────────────────────────────────

    _buildHtml() {
        const CSS = [
            ':root{--bg0:#0d1117;--bg1:#161b22;--bg2:#1c2128;--bg3:#262c36;',
            '--border:#30363d;--border2:#3d444d;',
            '--blue:#58a6ff;--blue-dim:#1f6feb;--green:#3fb950;--yellow:#e3b341;',
            '--red:#f85149;--orange:#f0883e;--purple:#a371f7;',
            '--text:#e6edf3;--muted:#8b949e;--dim:#656d76;',
            '--mono:"JetBrains Mono","Fira Code",monospace;}',
            '*{box-sizing:border-box;margin:0;padding:0;}',
            'body{background:var(--bg0);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;min-height:100vh;}',
            '#app{display:flex;flex-direction:column;height:100vh;}',
            '.header{background:var(--bg1);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;gap:16px;height:56px;flex-shrink:0;}',
            '.header-logo{display:flex;align-items:center;gap:10px;}',
            '.header-logo svg{width:32px;height:32px;}',
            '.header-title{font-size:18px;font-weight:700;}',
            '.header-sub{font-size:12px;color:var(--muted);}',
            '.header-stats{margin-left:auto;display:flex;gap:16px;font-size:12px;color:var(--muted);}',
            '.stat-item span{color:var(--text);font-weight:600;}',
            '.tabs{background:var(--bg1);border-bottom:1px solid var(--border);display:flex;padding:0 20px;flex-shrink:0;overflow-x:auto;}',
            '.tab{padding:12px 18px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);font-size:13px;font-weight:500;transition:all .15s;white-space:nowrap;}',
            '.tab:hover{color:var(--text);} .tab.active{color:var(--blue);border-bottom-color:var(--blue);}',
            '.panels{flex:1;overflow:hidden;position:relative;}',
            '.panel{display:none;height:100%;overflow-y:auto;padding:20px;} .panel.active{display:block;}',
            '.card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;}',
            '.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}',
            '.card-title{font-size:14px;font-weight:600;}',
            '.btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;gap:6px;}',
            '.btn-primary{background:var(--blue-dim);color:#fff;} .btn-primary:hover{background:var(--blue);}',
            '.btn-success{background:#196c2e;color:var(--green);} .btn-success:hover{background:#1f7a34;}',
            '.btn-danger{background:#3d0f0f;color:var(--red);} .btn-danger:hover{background:#4d1414;}',
            '.btn-ghost{background:var(--bg3);color:var(--text);border:1px solid var(--border);} .btn-ghost:hover{border-color:var(--blue);}',
            '.btn-sm{padding:4px 10px;font-size:12px;}',
            '.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;}',
            '.badge-blue{background:#1f3a5f;color:var(--blue);} .badge-green{background:#1a3a22;color:var(--green);}',
            '.badge-orange{background:#3d2200;color:var(--orange);} .badge-purple{background:#2d1f4a;color:var(--purple);}',
            '.badge-red{background:#3d0f0f;color:var(--red);} .badge-yellow{background:#3d2f00;color:var(--yellow);}',
            '.cal-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;}',
            '.cal-title{font-size:18px;font-weight:700;min-width:200px;text-align:center;}',
            '.view-btns{display:flex;background:var(--bg3);border-radius:6px;padding:2px;}',
            '.view-btn{padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;color:var(--muted);}',
            '.view-btn.active{background:var(--blue-dim);color:#fff;}',
            '.cal-grid-month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:var(--border);border-radius:8px;overflow:hidden;}',
            '.cal-day-header{background:var(--bg2);padding:8px;text-align:center;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;}',
            '.cal-cell{background:var(--bg2);min-height:90px;padding:6px;cursor:pointer;transition:background .1s;overflow:hidden;min-width:0;width:100%;}',
            '.cal-cell:hover{background:var(--bg3);} .cal-cell.today{background:#1a2d4a;}',
            '.cal-cell.other-month .cal-day-num{color:var(--dim);}',
            '.cal-day-num{font-size:12px;font-weight:600;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;}',
            '.cal-today-dot{width:22px;height:22px;background:var(--blue);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;}',
            '.event-chip{border-radius:3px;padding:2px 5px;font-size:10px;margin-bottom:2px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;display:block;width:100%;box-sizing:border-box;}',
            '.cal-week{display:grid;grid-template-columns:48px repeat(7,1fr);border-radius:8px;overflow:hidden;border:1px solid var(--border);}',
            '.week-col-header{background:var(--bg2);padding:8px 4px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);position:sticky;top:0;z-index:2;}',
            '.week-col-header.today-col{color:var(--blue);font-weight:700;}',
            '.week-slot{height:48px;border-bottom:1px solid var(--border);background:var(--bg2);position:relative;cursor:pointer;}',
            '.week-slot:hover{background:var(--bg3);}',
            '.week-time-label{height:48px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;padding:3px;font-size:10px;color:var(--dim);font-family:var(--mono);background:var(--bg1);}',
            '.week-event{position:absolute;left:2px;right:2px;border-radius:3px;padding:2px 4px;font-size:10px;overflow:hidden;cursor:pointer;z-index:1;}',
            '.task-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px;}',
            '.task-check{width:20px;height:20px;border-radius:50%;border:2px solid var(--border2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;margin-top:2px;}',
            '.task-check.checked{background:var(--green);border-color:var(--green);}',
            '.task-body{flex:1;} .task-title{font-size:14px;font-weight:500;margin-bottom:4px;}',
            '.task-meta{display:flex;gap:8px;flex-wrap:wrap;}',
            '.bday-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px;display:flex;align-items:center;gap:14px;}',
            '.bday-avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#f0883e,#f85149);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}',
            '.bday-today{border-color:var(--orange);background:#1c1a16;} .bday-soon{border-color:var(--yellow);}',
            '.bday-countdown{font-size:24px;font-weight:800;color:var(--orange);min-width:48px;text-align:center;}',
            '.bday-countdown.today-val{color:var(--green);}',
            '.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;align-items:center;justify-content:center;}',
            '.modal-overlay.open{display:flex;}',
            '.modal{background:var(--bg1);border:1px solid var(--border2);border-radius:12px;padding:24px;width:560px;max-width:96vw;max-height:88vh;overflow-y:auto;}',
            '.modal h3{font-size:16px;font-weight:700;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border);}',
            '.form-row{margin-bottom:14px;}',
            '.form-row label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px;}',
            '.form-row input,.form-row select,.form-row textarea{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px;outline:none;transition:border .15s;}',
            '.form-row input:focus,.form-row select:focus,.form-row textarea:focus{border-color:var(--blue);}',
            '.form-row textarea{min-height:60px;resize:vertical;font-family:inherit;}',
            '.form-row select option{background:var(--bg2);}',
            '.form-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
            '.form-divider{border:none;border-top:1px solid var(--border);margin:16px 0;}',
            '.form-section{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;}',
            '.seg-row{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:6px;display:flex;gap:8px;align-items:flex-start;}',
            '.seg-inner{flex:1;display:flex;flex-direction:column;gap:6px;}',
            '.seg-type-sel{background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:5px 8px;font-size:12px;width:120px;flex-shrink:0;}',
            '.seg-input{background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:6px 8px;font-size:12px;width:100%;}',
            '.seg-input:focus{border-color:var(--blue);outline:none;}',
            '.seg-preview{font-size:11px;color:var(--green);font-style:italic;padding:2px 6px;}',
            '.alexa-chip-list{display:flex;flex-direction:column;gap:5px;margin-top:6px;}',
            '.alexa-chip{display:flex;align-items:center;gap:8px;background:var(--bg3);border-radius:6px;padding:6px 10px;font-size:12px;}',
            '.alexa-chip span{flex:1;color:var(--muted);}',
            '.log-entry{font-family:var(--mono);font-size:11px;padding:5px 8px;border-bottom:1px solid var(--border);display:flex;gap:10px;line-height:1.5;}',
            '.log-ts{color:var(--dim);min-width:80px;flex-shrink:0;} .log-level{min-width:40px;flex-shrink:0;font-weight:700;}',
            '.log-cat{min-width:70px;flex-shrink:0;color:var(--muted);} .log-msg{color:var(--text);}',
            '.lv-info{color:var(--blue);} .lv-warn{color:var(--yellow);} .lv-error{color:var(--red);} .lv-debug{color:var(--dim);}',
            '.sys-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;}',
            '.sys-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center;}',
            '.sys-val{font-size:28px;font-weight:800;color:var(--blue);margin-bottom:4px;} .sys-label{font-size:12px;color:var(--muted);}',
            '.color-swatches{display:flex;gap:8px;margin-top:6px;}',
            '.swatch{width:24px;height:24px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .15s;}',
            '.swatch.selected,.swatch:hover{border-color:#fff;transform:scale(1.15);}',
            '.ics-badge{display:inline-flex;align-items:center;gap:4px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:11px;color:var(--purple);}',
            '.trigger-box{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px;}',
            '.trigger-box-title{font-size:12px;font-weight:700;color:var(--yellow);margin-bottom:10px;display:flex;align-items:center;gap:6px;}',
            '::-webkit-scrollbar{width:6px;height:6px;} ::-webkit-scrollbar-track{background:var(--bg0);} ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px;}',
            '.empty-state{text-align:center;padding:60px 20px;color:var(--muted);} .empty-state .icon{font-size:48px;margin-bottom:12px;}',
            '@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .panel.active{animation:fadeIn .2s ease;}',
            '@media(max-width:600px){.form-cols{grid-template-columns:1fr;} .cal-week{overflow-x:auto;} .modal{padding:16px;}}'
        ].join('\n');

        const LOGO_SVG = '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect width="32" height="32" rx="8" fill="#1f6feb"/>' +
            '<rect x="6" y="8" width="20" height="18" rx="3" fill="none" stroke="#58a6ff" stroke-width="1.5"/>' +
            '<line x1="6" y1="13" x2="26" y2="13" stroke="#58a6ff" stroke-width="1.5"/>' +
            '<line x1="11" y1="6" x2="11" y2="10" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round"/>' +
            '<line x1="21" y1="6" x2="21" y2="10" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round"/>' +
            '<rect x="10" y="17" width="4" height="4" rx="1" fill="#58a6ff" opacity=".8"/>' +
            '<rect x="16" y="17" width="4" height="4" rx="1" fill="#3fb950" opacity=".8"/>' +
            '</svg>';

        const TABS = [
            { id: 'cal',    icon: '\uD83D\uDCC5', label: 'Kalender' },
            { id: 'tasks',  icon: '\u2705',       label: 'Aufgaben' },
            { id: 'bdays',  icon: '\uD83C\uDF82', label: 'Geburtstage' },
            { id: 'logs',   icon: '\uD83D\uDCCB', label: 'Logs' },
            { id: 'system', icon: '\u2699\uFE0F', label: 'System' },
        ];

        const tabsHtml = TABS.map(t =>
            '<div class="tab" data-panel="' + t.id + '" onclick="switchTab(this.dataset.panel)">' + t.icon + ' ' + t.label + '</div>'
        ).join('');

        return '<!DOCTYPE html><html lang="de"><head>' +
            '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>ioBroker Kalender</title><style>' + CSS + '</style></head><body>' +
            '<div id="app">' +
            '<div class="header"><div class="header-logo">' + LOGO_SVG +
            '<div><div class="header-title">ioBroker Kalender</div>' +
            '<div class="header-sub" id="hdr-sub">Lade...</div></div></div>' +
            '<div class="header-stats">' +
            '<div class="stat-item" style="font-size:16px;font-weight:700;color:var(--blue);font-family:var(--mono);letter-spacing:1px;"><span id="hdr-clock">&ndash;</span></div>' +
            '<div class="stat-item">Termine: <span id="hdr-ev">\u2013</span></div>' +
            '<div class="stat-item">Heute: <span id="hdr-today">\u2013</span></div>' +
            '<div class="stat-item">Geburtstage: <span id="hdr-bd">\u2013</span></div>' +
            '</div></div>' +
            '<div class="tabs">' + tabsHtml + '</div>' +
            '<div class="panels">' +
            '<div class="panel active" id="panel-cal"></div>' +
            '<div class="panel" id="panel-tasks"></div>' +
            '<div class="panel" id="panel-bdays"></div>' +
            '<div class="panel" id="panel-logs"></div>' +
            '<div class="panel" id="panel-system"></div>' +
            '</div></div>' +
            '<div class="modal-overlay" id="event-modal"><div class="modal" id="event-modal-inner"></div></div>' +
            '<div class="modal-overlay" id="bday-modal"><div class="modal" id="bday-modal-inner"></div></div>' +
            '<script src="app.js"></script></body></html>';
    }
}

// ── Entry Point ───────────────────────────────────────────────────────────────

if (require.main !== module) {
    module.exports = (options) => new KalenderAdapter(options);
} else {
    new KalenderAdapter();
}
