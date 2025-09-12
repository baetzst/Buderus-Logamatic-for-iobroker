const MQTT_STATE = 'mqtt.0.heizung.burner.can.raw.recv'; // <-- adjust to your mqtt state
const ROOT = '0_userdata.0.Heizung.Buderus';             // <-- adjust your destination

// Utility: safe state creation / update
function setDP(path, val) {
    if (val === null || val === undefined) return;
    //const id = ROOT + '.' + path.replace(/\s+/g, '_').replace(/\//g, '_').replace(/\./g, '_');
    const id = ROOT + '.' + path.replace(/\s+/g, '_').replace(/\//g, '.');
    let stVal = val;
    if (typeof val === 'object') {
        stVal = JSON.stringify(val);
    }
    if (!existsState(id)) {
        createState(id, stVal);
        log('Logamatic: Created ' + id + ' = ' + stVal, 'debug');
    } else {
        setState(id, stVal, true);
        log('Logamatic: Updated ' + id + ' = ' + stVal, 'debug');
    }
}

// ------- DataType implementations (port of Python classes) -------

// Base class emulation via factory functions returning decoder objects
function DataUInt8(name) {
    return {
        name: name,
        decode: function(byte) { return (byte === undefined) ? null : { [this.name]: byte }; }
    };
}
function DataUint8Hex(name) {
    return {
        name: name,
        decode: function(byte) { if (byte === undefined) return null; return { [this.name]: '0x' + byte.toString(16).padStart(2,'0') }; }
    };
}
function DataTempVorl(name) {
    return DataUInt8(name); // same behaviour
}
function DataTempRueckl(name) { return DataUInt8(name); }
function DataTempWW(name) { return DataUInt8(name); }

function DataTempRaum(name) {
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const t = byte / 2;
            if (t === 55) return null;
            return { [this.name]: t };
        },
        encode: function(value) { return Math.round(parseFloat(value) * 2); }
    };
}

function DataTempAussen(name) {
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            // signed 8-bit
            const v = (byte & 0x80) ? byte - 256 : byte;
            return { [this.name]: v };
        },
        encode: function(value) { return parseInt(value); }
    };
}

function DataTempSol(name) {
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            if (byte === 110) return null;
            return { [this.name]: byte };
        },
        encode: function(value) { return parseInt(value); }
    };
}

// Multi-byte collector (2 bytes)
function DataTempCollector(bytecount, name) {
    const parent = {
        name: name,
        bytesvalues: new Array(bytecount).fill(0)
    };
    parent.bytehooks = [];
    for (let i=0;i<bytecount;i++) {
        (function(i){
            parent.bytehooks[i] = {
                name: parent.name + ' byte ' + i,
                decode: function(byte) {
                    parent.bytesvalues[i] = byte;
                    if (i === 0) {
                        // byte0 is last -> compute (byte1 * 256 + byte0) / 10
                        const coltemp_value = (parent.bytesvalues[1] * 256 + parent.bytesvalues[0]) / 10;
                        return { [parent.name]: coltemp_value };
                    } else {
                        return null;
                    }
                }
            };
        })(i);
    }
    parent.byte = function(i) { return parent.bytehooks[i]; };
    return parent;
}

// Solar hours (3 bytes) -> pump runtime: (b2*65536 + b1*256 + b0) / 60
function DataSolarHours(bytecount, name) {
    const parent = {
        name: name,
        bytesvalues: new Array(bytecount).fill(0)
    };
    parent.bytehooks = [];
    for (let i=0;i<bytecount;i++) {
        (function(i){
            parent.bytehooks[i] = {
                name: parent.name + ' byte ' + i,
                decode: function(byte) {
                    parent.bytesvalues[i] = byte;
                    if (i === 0) {
                        const solarhours_value = Math.round(( (parent.bytesvalues[2]*65536 + parent.bytesvalues[1]*256 + parent.bytesvalues[0]) / 60) * 100) / 100;
                        return { [parent.name]: solarhours_value };
                    } else {
                        return null;
                    }
                }
            };
        })(i);
    }
    parent.byte = function(i) { return parent.bytehooks[i]; };
    return parent;
}

// DataUIntMultiByte: variable bytecount, on byteindex==0 combine little-endian bytes
function DataUIntMultiByte(bytecount, name) {
    const parent = {
        name: name,
        bytesvalues: new Array(bytecount).fill(0)
    };
    parent.bytehooks = [];
    for (let i=0;i<bytecount;i++) {
        (function(i){
            parent.bytehooks[i] = {
                name: parent.name + 'byte ' + i,
                decode: function(byte) {
                    parent.bytesvalues[i] = byte;
                    if (i === 0) {
                        // combine little-endian
                        let v = 0;
                        for (let j=0;j<bytecount;j++) {
                            v |= (parent.bytesvalues[j] << (8*j));
                        }
                        return { [parent.name]: v };
                    } else {
                        return null;
                    }
                }
            };
        })(i);
    }
    parent.byte = function(i) { return parent.bytehooks[i]; };
    return parent;
}

// Slot mapping
function DataSlot(name) {
    const map = {
        1: "frei",2: "ZM432",3: "FM442",4: "FM441",5: "FM447",
        6: "ZM432",7: "FM445",8: "FM451",9: "FM454",10: "ZM424",
        11:"UBA",12:"FM452",13:"FM448",14:"ZM433",15:"FM446",
        16:"FM443",17:"FM455",21:"FM444"
    };
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            if (map[byte]) return { [this.name]: map[byte] };
            return null;
        }
    };
}

// Bit flag decoders
function DataHKStat1(name) {
    const map = ['Ausschaltoptimierung','Einschaltoptimierung','Automatik','Warmwasservorrang','Estrichtrocknung','Ferien','Frostschutz','Manuell'];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<8;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}
function DataHKStat2(name) {
    const map = ['Sommer','Tag','keine Kommunikation mit FB','FB fehlerhaft','Fehler Vorlauffühler','maximaler Vorlauf','externer Störeingang','Party'];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<8;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}
function DataWWStat1(name) {
    const map = ['Automatik','Desinfektion','Nachladung','Ferien','Fehler Desinfektion','Fehler Fühler','Fehler WW bleibt kalt','Fehler Anode'];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<8;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}
function DataWWStat2(name) {
    const map = ['Laden','Manuell','Nachladen','Ausschaltoptimierung','Einschaltoptimierung','Tag','Warm','Vorrang'];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<8;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}

// Solar status and BW flags
function DataSolStat1(name) {
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            if (byte === 0) return null;
            const map = {1:'Stillstand',2:'Low Flow',3:'High Flow',4:'HAND ein',5:'Umschalt-Check'};
            return { [this.name]: map[byte] || ('Val_'+byte) };
        }
    };
}
function DataSolBW1(name) {
    const map = ['Fehler Einstellung Hysterese','Speicher 2 auf max. Temperatur','Speicher 1 auf max. Temperatur','Kollektor auf max. Temperatur'];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<4;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}
function DataSolBW2(name) {
    const map = [
        'Fehler Fühler Anlagenrücklauf Bypass defekt',
        'Fehler Fühler Speichermitte Bypass defekt',
        'Fehler Volumenstromzähler WZ defekt',
        'Fehler Fühler Rücklauf WZ defekt',
        'Fehler Fühler Vorlauf WZ defekt',
        'Fehler Fühler Speicher-unten 2 defekt',
        'Fehler Fühler Speicher-unten 1 defekt',
        'Fehler Fühler Kollektor defekt'
    ];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<8;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}
function DataSolBW3(name) {
    const map = ['Umschaltventil Speicher 2 zu','Umschaltventil Speicher 2 auf/Speicherladepumpe2','Umschaltventil Bypass zu','Umschaltventil Bypass auf','Sekundärpumpe Speicher 2 Betrieb'];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const flags = [];
            for (let i=0;i<5;i++) if (byte & (1<<i)) flags.push(map[i]);
            return { [this.name]: flags.length ? flags.join(', ') : 'none' };
        }
    };
}

// ------- Object base and monitor classes -------

function Obase(monid, name, datalen) {
    this.monid = monid;
    this.name = name;
    this.prefix = 'base/' + name;
    this.datalen = datalen;
    this.mem = new Array(datalen).fill(null);
    this.datatypes = new Array(datalen).fill(null);
    this.values = {};
    this.value_timestamps = {};
}
Obase.prototype.recv = function(databytes) {
    const blocklen = 6;
    const now = Date.now();
    const i = databytes[0];
    if (i >= this.datalen) {
        log('Logamatic: Invalid start index ' + i + ' for monitor 0x' + this.monid.toString(16) + ' with datalen ' + this.datalen, 'debug');
        return;
    }
    if (i + blocklen > this.datalen) {
        log('Logamatic: Monitor 0x' + this.monid.toString(16) + ' data out of bounds ' + this.datalen, 'debug');
        return;
    }
    const block = databytes.slice(1, 1+blocklen);
    for (let p=0;p<blocklen;p++) {
        this.mem[i+p] = block[p];
    }
    for (let p=i; p<i+blocklen; p++) {
        const dtype = this.datatypes[p];
        if (!dtype) continue;
        try {
            const newval = dtype.decode(this.mem[p]);
            if (newval) {
                for (const nk in newval) {
                    const k = this.prefix + '/' + nk;
                    if (!(k in this.values) || this.values[k] !== newval[nk]) {
                        this.values[k] = newval[nk];
                        this.value_timestamps[k] = now;
                        setDP(this.name + '.' + nk.replace(/\s+/g,'_'), newval[nk]);
                    }
                }
            }
        } catch (e) {
            log('Logamatic: decode error for ' + this.name + ' index ' + p + ' : ' + e, 'error');
        }
    }
};

function MonBase(monid, name, datalen) {
    Obase.call(this, monid, name, datalen);
    this.prefix = 'mon/' + name;
}
MonBase.prototype = Object.create(Obase.prototype);
MonBase.prototype.constructor = MonBase;

// Specific monitors (instantiate and fill datatypes at relevant indexes)
function MonHeizkreis(monid, name) {
    MonBase.call(this, monid, name, 18);
    this.datatypes[0] = DataHKStat1('Betriebswerte_1');
    this.datatypes[1] = DataHKStat2('Betriebswerte_2');
    this.datatypes[2] = DataTempVorl('Vorlaufsolltemperatur');
    this.datatypes[3] = DataTempVorl('Vorlaufisttemperatur');
    this.datatypes[4] = DataTempRaum('Raumsolltemperatur');
    this.datatypes[5] = DataTempRaum('Raumisttemperatur');
    this.datatypes[8] = DataUInt8('Pumpe');
    this.datatypes[9] = DataUInt8('Stellglied');
}
MonHeizkreis.prototype = Object.create(MonBase.prototype);
MonHeizkreis.prototype.constructor = MonHeizkreis;

function MonKessel(monid, name) {
    MonBase.call(this, monid, name, 42);
    this.datatypes[0] = DataTempVorl('Kesselvorlauf-Solltemperatur');
    this.datatypes[1] = DataTempVorl('Kesselvorlauf-Isttemperatur');
    this.datatypes[7] = DataUint8Hex('Kesselstatus');
    this.datatypes[8] = DataUInt8('Brenner_Ansteuerung');
    this.datatypes[34] = DataUint8Hex('Brennerstatus');
}
MonKessel.prototype = Object.create(MonBase.prototype);
MonKessel.prototype.constructor = MonKessel;

function MonKesselHaengend(monid, name) {
    MonBase.call(this, monid, name, 60);
    this.datatypes[6] = DataTempVorl('Kesselvorlauf-Solltemperatur');
    this.datatypes[7] = DataTempVorl('Kesselvorlauf-Isttemperatur');
    this.datatypes[14] = DataUint8Hex('HD-Mode_der_UBA');
    this.datatypes[20] = DataTempRueckl('Kesselruecklauf-Isttemperatur');
}
MonKesselHaengend.prototype = Object.create(MonBase.prototype);
MonKesselHaengend.prototype.constructor = MonKesselHaengend;

function MonConf(monid, name) {
    MonBase.call(this, monid, name, 24);
    this.datatypes[0] = DataTempAussen('Außentemperatur');
    this.datatypes[6] = DataSlot('Modul_in_Slot_1');
    this.datatypes[7] = DataSlot('Modul_in_Slot_2');
    this.datatypes[8] = DataSlot('Modul_in_Slot_3');
    this.datatypes[9] = DataSlot('Modul_in_Slot_4');
    this.datatypes[10] = DataSlot('Modul_in_Slot_A');
    this.datatypes[18] = DataTempVorl('Anlagenvorlaufsolltemperatur');
    this.datatypes[19] = DataTempVorl('Anlagenvorlaufisttemperatur');
    this.datatypes[23] = DataTempVorl('Regelgeraetevorlaufisttemperatur');
}
MonConf.prototype = Object.create(MonBase.prototype);
MonConf.prototype.constructor = MonConf;

function MonSolar(monid, name) {
    MonBase.call(this, monid, name, 54);
    this.datatypes[0] = DataSolBW1('Betriebswerte_1');
    this.datatypes[1] = DataSolBW2('Betriebswerte_2');
    this.datatypes[2] = DataSolBW3('Betriebswerte_3');

    const coltemp = DataTempCollector(2, 'Collectortemperatur');
    this.datatypes[3] = coltemp.byte(1);
    this.datatypes[4] = coltemp.byte(0);

    this.datatypes[5] = DataUInt8('Modulation_Pumpe');
    this.datatypes[6] = DataTempSol('T1_Temp_unten');
    this.datatypes[7] = DataSolStat1('T1_Betriebsstatus');
    this.datatypes[8] = DataTempSol('T2_Temp_unten');
    this.datatypes[9] = DataSolStat1('T2_Betriebsstatus');
    this.datatypes[10] = DataTempVorl('Temperatur_Speichermitte');
    this.datatypes[11] = DataTempVorl('Anlagenruecklauftemperatur');

    const solarhours = DataSolarHours(3, 'Betriebsstunden');
    this.datatypes[24] = solarhours.byte(2);
    this.datatypes[25] = solarhours.byte(1);
    this.datatypes[26] = solarhours.byte(0);
}
MonSolar.prototype = Object.create(MonBase.prototype);
MonSolar.prototype.constructor = MonSolar;

function MonWaermemenge(monid, name) {
    MonBase.call(this, monid, name, 36);
    const overall = DataUIntMultiByte(4, 'W_overall');
    this.datatypes[30] = overall.byte(3);
    this.datatypes[31] = overall.byte(2);
    this.datatypes[32] = overall.byte(1);
    this.datatypes[33] = overall.byte(0);

    const today = DataUIntMultiByte(2, 'W_today');
    this.datatypes[6] = today.byte(1);
    this.datatypes[7] = today.byte(0);

    const yesterday = DataUIntMultiByte(2, 'W_yesterday');
    this.datatypes[8] = yesterday.byte(1);
    this.datatypes[9] = yesterday.byte(0);
}
MonWaermemenge.prototype = Object.create(MonBase.prototype);
MonWaermemenge.prototype.constructor = MonWaermemenge;

function MonWarmWasser(monid, name) {
    MonBase.call(this, monid, name, 12);
    this.datatypes[0] = DataWWStat1('Betriebswerte_1');
    this.datatypes[1] = DataWWStat2('Betriebswerte_2');
    this.datatypes[2] = DataTempWW('Warmwasser_Solltemperatur');
    this.datatypes[3] = DataTempWW('Warmwasser_Isttemperatur');
}
MonWarmWasser.prototype = Object.create(MonBase.prototype);
MonWarmWasser.prototype.constructor = MonWarmWasser;

// ConfBase for configuration encoding (we only read config monitor data)
function ConfBase(monid, name, datalen) {
    Obase.call(this, monid, name, datalen);
    this.prefix = 'cnf/' + name;
}
ConfBase.prototype = Object.create(Obase.prototype);
ConfBase.prototype.constructor = ConfBase;

function DataHKMode(name) {
    const codes = ["AUS","EIN","AUT"];
    return {
        name: name,
        decode: function(byte) {
            if (byte === undefined) return null;
            const v = codes[byte] || 'ERR';
            return { [this.name]: v };
        },
        encode: function(value) {
            const i = (typeof value === 'number') ? value : codes.indexOf(value);
            return i;
        }
    };
}

function ConfHeizkreis(monid, name) {
    ConfBase.call(this, monid, name, 62);
    this.datatypes[1] = DataTempAussen('T_Sommer');
    this.datatypes[2] = DataTempRaum('T_Nacht');
    this.datatypes[3] = DataTempRaum('T_Tag');
    this.datatypes[4] = DataHKMode('Modus');
}
ConfHeizkreis.prototype = Object.create(ConfBase.prototype);
ConfHeizkreis.prototype.constructor = ConfHeizkreis;

function ConfWarmwasser(monid, name) {
    ConfBase.call(this, monid, name, 41);
    this.datatypes[10] = DataTempWW('T_s');
    this.datatypes[14] = DataHKMode('Modus');
}
ConfWarmwasser.prototype = Object.create(ConfBase.prototype);
ConfWarmwasser.prototype.constructor = ConfWarmwasser;

// ------- Monitor & Conf type registries (from Python file) -------
const monitor_types = {
    0x80: { name: "Heizkreis_1", datalen:18, dataclass: MonHeizkreis },
    0x81: { name: "Heizkreis_2", datalen:18, dataclass: MonHeizkreis },
    0x82: { name: "Heizkreis_3", datalen:18, dataclass: MonHeizkreis },
    0x83: { name: "Heizkreis_4", datalen:18, dataclass: MonHeizkreis },
    0x84: { name: "Warmwasser", datalen:12, dataclass: MonWarmWasser },
    0x85: { name: "Strategie_wandhaengend", datalen:12, dataclass: null },
    0x87: { name: "Fehlerprotokoll", datalen:42, dataclass: null },
    0x88: { name: "Kessel_bodenstehend", datalen:42, dataclass: MonKessel, shortname: "Kessel" },
    0x89: { name: "Konfiguration", datalen:24, dataclass: MonConf },
    0x8A: { name: "Heizkreis_5", datalen:18, dataclass: MonHeizkreis },
    0x8B: { name: "Heizkreis_6", datalen:18, dataclass: MonHeizkreis },
    0x8C: { name: "Heizkreis_7", datalen:18, dataclass: MonHeizkreis },
    0x8D: { name: "Heizkreis_8", datalen:18, dataclass: MonHeizkreis },
    0x8E: { name: "Heizkreis_9", datalen:18, dataclass: MonHeizkreis },
    0x8F: { name: "Strategie_bodenstehend", datalen:30, dataclass: null },
    0x90: { name: "LAP", datalen:18, dataclass: null },
    0x92: { name: "Kessel_1_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x93: { name: "Kessel_2_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x94: { name: "Kessel_3_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x95: { name: "Kessel_4_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x96: { name: "Kessel_5_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x97: { name: "Kessel_6_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x98: { name: "Kessel_7_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x99: { name: "Kessel_8_wandhaengend", datalen:60, dataclass: MonKesselHaengend, shortname: "Kessel" },
    0x9A: { name: "KNX_FM446", datalen:60, dataclass: null },
    0x9B: { name: "Wärmemenge", datalen:36, dataclass: MonWaermemenge, shortname: "Waermemenge" },
    0x9C: { name: "Störmeldemodul", datalen:6, dataclass: null },
    0x9D: { name: "Unterstation", datalen:6, dataclass: null },
    0x9E: { name: "Solar", datalen:54, dataclass: MonSolar, shortname: "Solar" },
    0x9F: { name: "alternativer_Waermeerzeuger", datalen:42, dataclass: null }
};

const conf_types = {
    0x07: { name: "Heizkreis_1", datalen:62, dataclass: ConfHeizkreis },
    0x08: { name: "Heizkreis_2", datalen:62, dataclass: ConfHeizkreis },
    0x09: { name: "Heizkreis_3", datalen:62, dataclass: null },
    0x0A: { name: "Heizkreis_4", datalen:62, dataclass: null },
    0x0B: { name: "Außenparameter", datalen:12, dataclass: null },
    0x0C: { name: "Warmwasser", datalen:41, dataclass: ConfWarmwasser },
    0x0D: { name: "Konfiguration_Modulauswahl", datalen:18, dataclass: null },
    0x0E: { name: "Strategie_wandhaengend_UBA", datalen:18, dataclass: null },
    0x10: { name: "Kessel_bodenstehend_conf", datalen:18, dataclass: null },
    0x11: { name: "Schaltuhr_Kanal1", datalen:18, dataclass: null },
    0x12: { name: "Schaltuhr_Kanal2", datalen:18, dataclass: null },
    0x13: { name: "Schaltuhr_Kanal3", datalen:18, dataclass: null },
    0x14: { name: "Schaltuhr_Kanal4", datalen:18, dataclass: null },
    0x15: { name: "Schaltuhr_Kanal5", datalen:18, dataclass: null },
    0x16: { name: "Heizkreis_5_conf", datalen:62, dataclass: ConfHeizkreis },
    0x17: { name: "Schaltuhr_Kanal6", datalen:18, dataclass: null },
    0x18: { name: "Heizkreis_6_conf", datalen:62, dataclass: null },
    0x19: { name: "Schaltuhr_Kanal7", datalen:18, dataclass: null },
    0x1A: { name: "Heizkreis_7_conf", datalen:62, dataclass: null },
    0x1B: { name: "Schaltuhr_Kanal8", datalen:18, dataclass: null },
    0x1C: { name: "Heizkreis_8_conf", datalen:62, dataclass: null },
    0x1D: { name: "Schaltuhr_Kanal9", datalen:18, dataclass: null },
    0x1F: { name: "Schaltuhr_Kanal10", datalen:18, dataclass: null },
    0x20: { name: "Strategie_bodenstehend", datalen:12, dataclass: null },
    0x24: { name: "Solar_conf", datalen:12, dataclass: null },
    0x26: { name: "Strategie_FM458", datalen:12, dataclass: null }
};

// reverse map of conf names to id (for reference; not used in read-only)
const conf_names = {};
for (const k in conf_types) conf_names[conf_types[k].name] = parseInt(k);

// data_objects store instantiated monitor/conf handlers
const data_objects = {};

// get_data_object: lazy instantiate dataclass
function get_data_object(oid, message_types) {
    if (!(oid in data_objects)) {
        if (oid in message_types) {
            const t = message_types[oid];
            if (t.dataclass) {
                const name = t.shortname ? t.shortname : t.name;
                try {
                    data_objects[oid] = new t.dataclass(oid, name);
                    log('Logamatic: Created data object for 0x' + oid.toString(16) + ': ' + name, 'info');
                } catch (e) {
                    log('Logamatic: Could not create object for 0x' + oid.toString(16) + ' : ' + e, 'error');
                }
            } else {
                log('Logamatic: No dataclass for oid 0x' + oid.toString(16), 'debug');
            }
        } else {
            log('Logamatic: Unknown monitor oid 0x' + oid.toString(16), 'debug');
        }
    }
    return data_objects[oid] || null;
}

// ------- MQTT message handler and main listener -------

on({ id: MQTT_STATE, change: 'any' }, function(obj) {
    try {
        const payload = obj.state.val;
        if (!payload) return;
        const parts = (''+payload).split(';');
        if (parts.length < 3) return;
        // parts: [rtr, pkidHex, hexbytes...]
        const pkid = parseInt(parts[1], 16);
        // the hex bytes may be space separated or continuous; normalize
        const hexpart = parts.slice(2).join(';').trim();
        const hexclean = hexpart.replace(/\x00/g,'').trim();
        // bytes separated by spaces likely
        const byteStrs = hexclean.split(/\s+/);
        const bytes = byteStrs.map(s => parseInt(s, 16));
        if (bytes.length === 0) return;
        const oid = bytes[0];
        // find data object either in monitor_types (pkid & 0x400) or conf_types
        let o = null;
        if (pkid & 0x400) {
            o = get_data_object(oid, monitor_types);
        } else {
            o = get_data_object(oid, conf_types);
        }
        if (!o) return;
        // pass databytes: in python they pass msg.data[1:] so here databytes = bytes[1:]
        const databytes = bytes.slice(1);
        // Expect databytes length 7: first = start index, next 6 bytes = payload
        if (databytes.length < 1) return;
        o.recv(databytes);
    } catch (e) {
        log('Logamatic: Exception in MQTT handler: ' + e, 'error');
    }
});

log('Logamatic: Script started (nested datapoints, read-only monitoring). Listening on ' + MQTT_STATE, 'info');