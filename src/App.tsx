import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ==========================================
// 1. SUPABASE KONFIGURACIJA
// ==========================================
// Zamenite ove vrednosti vašim podacima iz Supabase Dashboard-a:
// Settings -> API -> Project URL & Project API Keys (anon public)
export const SUPABASE_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || 
  'https://your-project-id.supabase.co';

export const SUPABASE_ANON_KEY = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || 
  'your-anon-key-here';

// Bezbedna inicijalizacija Supabase klijenta
let supabaseInstance: SupabaseClient | null = null;
const isSupabaseConfigured = 
  SUPABASE_URL && 
  SUPABASE_URL !== 'https://your-project-id.supabase.co' && 
  SUPABASE_ANON_KEY && 
  SUPABASE_ANON_KEY !== 'your-anon-key-here';

if (isSupabaseConfigured) {
  try {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.warn('Greška pri inicijalizaciji Supabase klijenta:', err);
  }
}

// SQL upit za kreiranje tabele i RLS pravila u Supabase
export const SUPABASE_SETUP_SQL = `-- 1. Kreiranje tabele schedule
CREATE TABLE IF NOT EXISTS public.schedule (
  date DATE PRIMARY KEY,
  parent TEXT CHECK (parent IN ('tata', 'mama') OR parent IS NULL),
  note TEXT
);

-- 2. Omogućavanje Row Level Security (RLS)
ALTER TABLE public.schedule ENABLE ROW LEVEL SECURITY;

-- 3. Javno čitanje za sve korisnike (Read-Only za dete)
CREATE POLICY "Dozvoli javno čitanje rasporeda"
ON public.schedule
FOR SELECT
TO anon, authenticated
USING (true);

-- 4. Dozvoli izmene za anon i autentifikovane korisnike
CREATE POLICY "Dozvoli unos i izmene rasporeda"
ON public.schedule
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);
`;

// ==========================================
// TIPOVI PODATAKA
// ==========================================
export type ParentStatus = 'tata' | 'mama' | null;

export interface DaySchedule {
  date: string; // YYYY-MM-DD
  parent: ParentStatus;
  note?: string | null;
}

// Nazivi meseci na srpskom jeziku
const MONTH_NAMES = [
  'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun',
  'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'
];

// Dani u nedelji (počevši od Ponedeljka)
const WEEK_DAYS = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];

// ==========================================
// GLAVNA KOMPONENTA
// ==========================================
export default function App() {
  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth()); // 0-11
  
  // Raspored podaci: mapa po datumu "YYYY-MM-DD"
  const [scheduleData, setScheduleData] = useState<Record<string, DaySchedule>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Admin režim provera preko URL parametra ?admin=true
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Modal za napomene
  const [activeModalDate, setActiveModalDate] = useState<string | null>(null);
  const [modalNoteText, setModalNoteText] = useState<string>('');
  const [modalParentStatus, setModalParentStatus] = useState<ParentStatus>(null);

  // Modal za SQL instrukcije
  const [showSqlModal, setShowSqlModal] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Provera URL upita pri montiranju
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const adminParam = params.get('admin');
      setIsAdmin(adminParam === 'true');
    } catch {
      setIsAdmin(false);
    }
  }, []);

  // Formatiranje ključa datuma (YYYY-MM-DD)
  const formatKey = (year: number, monthIndex: number, dayNumber: number): string => {
    const m = String(monthIndex + 1).padStart(2, '0');
    const d = String(dayNumber).padStart(2, '0');
    return `${year}-${m}-${d}`;
  };

  const todayKey = useMemo(() => {
    return formatKey(today.getFullYear(), today.getMonth(), today.getDate());
  }, [today]);

  // Učitavanje podataka za tekući mesec
  const fetchMonthSchedule = useCallback(async () => {
    setIsLoading(true);
    const startDate = formatKey(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const endDate = formatKey(currentYear, currentMonth, lastDay);

    if (supabaseInstance) {
      try {
        const { data, error } = await supabaseInstance
          .from('schedule')
          .select('date, parent, note')
          .gte('date', startDate)
          .lte('date', endDate);

        if (error) {
          console.error('Greška pri učitavanju sa Supabase:', error);
          loadFromLocalStorage();
        } else if (data) {
          const map: Record<string, DaySchedule> = {};
          data.forEach((item: any) => {
            map[item.date] = {
              date: item.date,
              parent: item.parent as ParentStatus,
              note: item.note || ''
            };
          });
          setScheduleData(prev => ({ ...prev, ...map }));
        }
      } catch (err) {
        console.error('Mrežna greška Supabase:', err);
        loadFromLocalStorage();
      }
    } else {
      // Fallback na LocalStorage kada Supabase ključevi nisu konfigurisani
      loadFromLocalStorage();
    }
    setIsLoading(false);
  }, [currentYear, currentMonth]);

  const loadFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem('family_kid_schedule');
      if (stored) {
        const parsed = JSON.parse(stored);
        setScheduleData(prev => ({ ...prev, ...parsed }));
      }
    } catch (e) {
      console.warn('LocalStorage nije dostupan', e);
    }
  };

  const saveToLocalStorage = (newSchedule: Record<string, DaySchedule>) => {
    try {
      localStorage.setItem('family_kid_schedule', JSON.stringify(newSchedule));
    } catch (e) {
      console.warn('Neuspešno čuvanje u LocalStorage', e);
    }
  };

  useEffect(() => {
    fetchMonthSchedule();
  }, [fetchMonthSchedule]);

  // Sledeći status u krugu: null ➔ tata ➔ mama ➔ null
  const getNextParent = (current: ParentStatus): ParentStatus => {
    if (!current) return 'tata';
    if (current === 'tata') return 'mama';
    return null;
  };

  // Promena statusa klikom na dan (samo u Admin režimu)
  const handleDayClick = async (dateStr: string) => {
    if (!isAdmin) return;

    const currentEntry = scheduleData[dateStr] || { date: dateStr, parent: null, note: null };
    const nextParent = getNextParent(currentEntry.parent);

    const updatedEntry: DaySchedule = {
      ...currentEntry,
      parent: nextParent
    };

    // Optimističko ažuriranje interfejsa
    const newSchedule = {
      ...scheduleData,
      [dateStr]: updatedEntry
    };
    setScheduleData(newSchedule);
    saveToLocalStorage(newSchedule);

    // Čuvanje u Supabase bazi
    if (supabaseInstance) {
      setSaveStatus('saving');
      try {
        const { error } = await supabaseInstance
          .from('schedule')
          .upsert({
            date: dateStr,
            parent: nextParent,
            note: currentEntry.note || null
          });

        if (error) {
          console.error('Greška pri ažuriranju dana:', error);
          setSaveStatus('error');
        } else {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 1500);
        }
      } catch (err) {
        console.error('Greška:', err);
        setSaveStatus('error');
      }
    }
  };

  // Otvaranje modala za napomenu
  const handleOpenNoteModal = (dateStr: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const entry = scheduleData[dateStr];
    setActiveModalDate(dateStr);
    setModalNoteText(entry?.note || '');
    setModalParentStatus(entry?.parent || null);
  };

  // Čuvanje napomene (u Admin režimu)
  const handleSaveModal = async () => {
    if (!activeModalDate || !isAdmin) return;

    const currentEntry = scheduleData[activeModalDate] || { date: activeModalDate, parent: null };
    const updatedEntry: DaySchedule = {
      ...currentEntry,
      parent: modalParentStatus,
      note: modalNoteText.trim() === '' ? null : modalNoteText.trim()
    };

    const newSchedule = {
      ...scheduleData,
      [activeModalDate]: updatedEntry
    };
    setScheduleData(newSchedule);
    saveToLocalStorage(newSchedule);

    if (supabaseInstance) {
      setSaveStatus('saving');
      try {
        const { error } = await supabaseInstance
          .from('schedule')
          .upsert({
            date: activeModalDate,
            parent: updatedEntry.parent,
            note: updatedEntry.note
          });

        if (error) {
          console.error('Greška pri čuvanju napomene:', error);
          setSaveStatus('error');
        } else {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 1500);
        }
      } catch (err) {
        console.error('Greška:', err);
        setSaveStatus('error');
      }
    }

    setActiveModalDate(null);
  };

  // Brisanje napomene (u Admin režimu)
  const handleDeleteNote = async () => {
    if (!activeModalDate || !isAdmin) return;

    const currentEntry = scheduleData[activeModalDate];
    if (!currentEntry) return;

    const updatedEntry: DaySchedule = {
      ...currentEntry,
      note: null
    };

    const newSchedule = {
      ...scheduleData,
      [activeModalDate]: updatedEntry
    };
    setScheduleData(newSchedule);
    saveToLocalStorage(newSchedule);

    if (supabaseInstance) {
      try {
        await supabaseInstance
          .from('schedule')
          .upsert({
            date: activeModalDate,
            parent: currentEntry.parent,
            note: null
          });
      } catch (err) {
        console.error(err);
      }
    }

    setActiveModalDate(null);
  };

  // Navigacija meseca
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  const handleResetToToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  // Proračun kalendarske mreže (od Ponedeljka = 0 do Nedelje = 6)
  const calendarCells = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    // JS getDay(): 0 = Nedelja, 1 = Ponedeljak ... 6 = Subota
    // Pomeraj da Ponedeljak bude 0:
    const mondayOffset = (firstDayIndex + 6) % 7;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const cells: Array<{ type: 'empty' | 'day'; day?: number; dateKey?: string }> = [];

    // Prazne ćelije pre prvog dana
    for (let i = 0; i < mondayOffset; i++) {
      cells.push({ type: 'empty' });
    }

    // Dani u mesecu
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        type: 'day',
        day: d,
        dateKey: formatKey(currentYear, currentMonth, d)
      });
    }

    return cells;
  }, [currentYear, currentMonth]);

  // Status za današnji dan
  const todayStatus = scheduleData[todayKey]?.parent;
  const todayNote = scheduleData[todayKey]?.note;

  // Formatirani datum za prikaz u modalu (npr. "16. Oktobar 2026")
  const formatFriendlyDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const monthName = MONTH_NAMES[m - 1] || '';
    return `${d}. ${monthName} ${y}.`;
  };

  // Boje prema kanonskim pravilima
  const getParentStyle = (parent: ParentStatus) => {
    if (parent === 'tata') {
      return {
        bg: '#2563eb', // Plava
        color: '#ffffff',
        border: '#1d4ed8',
        label: 'Tata',
        emoji: '💙'
      };
    }
    if (parent === 'mama') {
      return {
        bg: '#9333ea', // Ljubičasta
        color: '#ffffff',
        border: '#7e22ce',
        label: 'Mama',
        emoji: '💜'
      };
    }
    return {
      bg: '#f1f5f9', // Svetlosiva podloga
      color: '#334155',
      border: '#e2e8f0',
      label: 'Nije definisano',
      emoji: '⚪'
    };
  };

  return (
    <div style={styles.outerContainer}>
      <div style={styles.mobileCard}>
        
        {/* ================= HEADER / NASLOV ================= */}
        <header style={styles.header}>
          <div style={styles.titleRow}>
            <div style={styles.brandBadge}>
              <span style={{ fontSize: '20px' }}>🏠</span>
              <div>
                <h1 style={styles.titleText}>Dečiji Kalendar</h1>
                <p style={styles.subtitleText}>Gde sam danas i plan nedelje</p>
              </div>
            </div>

            {/* Indikator statusa baze / SQL pomoćnik */}
            <button 
              onClick={() => setShowSqlModal(true)}
              style={styles.databaseBadge}
              title="Supabase konfiguracija i SQL instrukcije"
            >
              {isSupabaseConfigured ? '⚡ Baza povezana' : '💾 Demo režim (SQL)'}
            </button>
          </div>

          {/* STATUS TRKA ZA REŽIM (ADMIN / READ-ONLY) */}
          <div style={isAdmin ? styles.adminBanner : styles.readOnlyBanner}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '14px' }}>{isAdmin ? '🔐' : '👀'}</span>
              <span style={styles.bannerText}>
                {isAdmin 
                  ? 'Admin Režim (Omogućene izmene)' 
                  : 'Samo pregled (Režim za dete)'}
              </span>
            </div>

            {/* Brzi taster za prelazak u admin/read-only ako korisnik želi da testira */}
            <a 
              href={isAdmin ? window.location.pathname : `${window.location.pathname}?admin=true`}
              style={styles.modeToggleLink}
            >
              {isAdmin ? 'Isključi admin' : 'Uključi admin'}
            </a>
          </div>

          {/* DANAŠNJI STATUS BANER */}
          <div style={styles.todayCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={styles.todayLabel}>Danas je {today.getDate()}. {MONTH_NAMES[today.getMonth()]}:</span>
                <div style={styles.todayParentRow}>
                  <span style={{ fontSize: '22px' }}>
                    {getParentStyle(todayStatus || null).emoji}
                  </span>
                  <span style={styles.todayParentName}>
                    {todayStatus === 'tata' && 'Danas sam sa Tatom!'}
                    {todayStatus === 'mama' && 'Danas sam sa Mamom!'}
                    {!todayStatus && 'Još nije unet raspored'}
                  </span>
                </div>
              </div>

              {todayNote && (
                <button 
                  onClick={() => handleOpenNoteModal(todayKey)}
                  style={styles.todayNoteButton}
                  title="Pogledaj današnju napomenu"
                >
                  📝 Napomena
                </button>
              )}
            </div>
          </div>

          {/* LEGENDA BOJA */}
          <div style={styles.legendRow}>
            <div style={styles.legendItem}>
              <span style={{ ...styles.legendDot, backgroundColor: '#2563eb' }} />
              <span style={styles.legendLabel}>Tata</span>
            </div>
            <div style={styles.legendItem}>
              <span style={{ ...styles.legendDot, backgroundColor: '#9333ea' }} />
              <span style={styles.legendLabel}>Mama</span>
            </div>
            <div style={styles.legendItem}>
              <span style={{ ...styles.legendDot, backgroundColor: '#cbd5e1' }} />
              <span style={styles.legendLabel}>Nije uneto</span>
            </div>
            {isAdmin && (
              <span style={styles.adminTip}>
                👉 Klik na dan menja roditelja
              </span>
            )}
          </div>
        </header>

        {/* ================= NAVIGACIJA MESECA ================= */}
        <div style={styles.navContainer}>
          <button 
            onClick={handlePrevMonth} 
            style={styles.navButton}
            aria-label="Prethodni mesec"
          >
            ‹
          </button>

          <div style={styles.monthDisplay}>
            <h2 style={styles.monthTitle}>
              {MONTH_NAMES[currentMonth]} {currentYear}
            </h2>
            {(currentMonth !== today.getMonth() || currentYear !== today.getFullYear()) && (
              <button onClick={handleResetToToday} style={styles.todayJumpBtn}>
                Vrati na danas
              </button>
            )}
          </div>

          <button 
            onClick={handleNextMonth} 
            style={styles.navButton}
            aria-label="Sledeći mesec"
          >
            ›
          </button>
        </div>

        {/* ================= KALENDAR MREŽA ================= */}
        <div style={styles.calendarWrapper}>
          {/* Nazivi dana u nedelji */}
          <div style={styles.weekDaysGrid}>
            {WEEK_DAYS.map((wd, index) => (
              <div 
                key={wd} 
                style={{
                  ...styles.weekDayHeader,
                  color: index >= 5 ? '#e11d48' : '#64748b' // Vikend istaknut
                }}
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Ćelije dana */}
          <div style={styles.daysGrid}>
            {calendarCells.map((cell, idx) => {
              if (cell.type === 'empty') {
                return <div key={`empty-${idx}`} style={styles.emptyCell} />;
              }

              const dateKey = cell.dateKey!;
              const isToday = dateKey === todayKey;
              const scheduleItem = scheduleData[dateKey];
              const parent = scheduleItem?.parent || null;
              const hasNote = Boolean(scheduleItem?.note && scheduleItem.note.trim().length > 0);
              const parentStyle = getParentStyle(parent);

              return (
                <div
                  key={dateKey}
                  onClick={() => handleDayClick(dateKey)}
                  style={{
                    ...styles.dayCell,
                    backgroundColor: parentStyle.bg,
                    color: parentStyle.color,
                    borderColor: isToday ? '#f59e0b' : parentStyle.border,
                    borderWidth: isToday ? '3px' : '1px',
                    cursor: isAdmin ? 'pointer' : 'default',
                    boxShadow: isToday ? '0 0 0 2px rgba(245, 158, 11, 0.4)' : 'none'
                  }}
                  title={
                    isAdmin 
                      ? `${cell.day}. ${MONTH_NAMES[currentMonth]} - Klik za promenu (Trenutno: ${parentStyle.label})`
                      : `${cell.day}. ${MONTH_NAMES[currentMonth]} - ${parentStyle.label}`
                  }
                >
                  {/* Broj dana i oznaka za danas */}
                  <div style={styles.dayTopRow}>
                    <span style={{
                      ...styles.dayNumber,
                      fontWeight: isToday ? '800' : '600'
                    }}>
                      {cell.day}
                    </span>

                    {/* Ikonica napomene */}
                    {hasNote && (
                      <button
                        onClick={(e) => handleOpenNoteModal(dateKey, e)}
                        style={{
                          ...styles.noteBadge,
                          backgroundColor: parent ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                        }}
                        title="Pogledaj napomenu"
                      >
                        📝
                      </button>
                    )}
                  </div>

                  {/* Središnji roditeljski prikaz */}
                  <div style={styles.dayCenterInfo}>
                    {parent ? (
                      <span style={styles.parentNameBadge}>
                        {parent === 'tata' ? 'TATA' : 'MAMA'}
                      </span>
                    ) : (
                      <span style={styles.emptyDayPlaceholder}>-</span>
                    )}
                  </div>

                  {/* Dugme za dodavanje napomene u admin režimu ako ne postoji */}
                  {isAdmin && !hasNote && (
                    <button
                      onClick={(e) => handleOpenNoteModal(dateKey, e)}
                      style={styles.addNoteTinyBtn}
                      title="Dodaj napomenu za ovaj dan"
                    >
                      +📝
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ================= STATUS SAČUVAVANJA ================= */}
        {saveStatus !== 'idle' && (
          <div style={styles.saveToast}>
            {saveStatus === 'saving' && '⏳ Čuvam izmene...'}
            {saveStatus === 'saved' && '✅ Sačuvano u bazi!'}
            {saveStatus === 'error' && '⚠️ Greška pri čuvanju.'}
          </div>
        )}

        {/* ================= FOOTER / INFO ================= */}
        <footer style={styles.footer}>
          <p style={styles.footerText}>
            {!isAdmin ? (
              <>Savet za roditelje: Dodajte <strong>?admin=true</strong> u URL link za izmenu rasporeda.</>
            ) : (
              <>Prijavljeni ste u <strong>Admin režimu</strong>. Izmene se odmah sinhronizuju sa bazom.</>
            )}
          </p>
        </footer>

      </div>

      {/* ======================================================== */}
      {/* POP-UP / MODAL ZA NAPOMENE (READ-ONLY ILI ADMIN REŽIM) */}
      {/* ======================================================== */}
      {activeModalDate && (
        <div style={styles.modalOverlay} onClick={() => setActiveModalDate(null)}>
          <div style={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>
                  {isAdmin ? 'Uređivanje dana' : 'Beleška za dan'}
                </h3>
                <span style={styles.modalSubtitle}>
                  📅 {formatFriendlyDate(activeModalDate)}
                </span>
              </div>
              <button 
                onClick={() => setActiveModalDate(null)} 
                style={styles.modalCloseIcon}
                aria-label="Zatvori"
              >
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              {/* STATUS RODITELJA (U ADMINU MOŽE DA SE PROMENI I OVDE) */}
              {isAdmin ? (
                <div style={styles.modalSection}>
                  <label style={styles.inputLabel}>Ko je sa detetom ovog dana?</label>
                  <div style={styles.parentRadioGroup}>
                    <button
                      type="button"
                      onClick={() => setModalParentStatus('tata')}
                      style={{
                        ...styles.parentSelectOption,
                        backgroundColor: modalParentStatus === 'tata' ? '#2563eb' : '#f8fafc',
                        color: modalParentStatus === 'tata' ? '#ffffff' : '#334155',
                        borderColor: modalParentStatus === 'tata' ? '#1d4ed8' : '#cbd5e1'
                      }}
                    >
                      💙 Tata
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalParentStatus('mama')}
                      style={{
                        ...styles.parentSelectOption,
                        backgroundColor: modalParentStatus === 'mama' ? '#9333ea' : '#f8fafc',
                        color: modalParentStatus === 'mama' ? '#ffffff' : '#334155',
                        borderColor: modalParentStatus === 'mama' ? '#7e22ce' : '#cbd5e1'
                      }}
                    >
                      💜 Mama
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalParentStatus(null)}
                      style={{
                        ...styles.parentSelectOption,
                        backgroundColor: modalParentStatus === null ? '#64748b' : '#f8fafc',
                        color: modalParentStatus === null ? '#ffffff' : '#334155',
                        borderColor: modalParentStatus === null ? '#475569' : '#cbd5e1'
                      }}
                    >
                      ⚪ Nedefinisano
                    </button>
                  </div>
                </div>
              ) : (
                <div style={styles.readOnlyParentBox}>
                  <span style={{ fontSize: '18px' }}>
                    {getParentStyle(scheduleData[activeModalDate]?.parent || null).emoji}
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {scheduleData[activeModalDate]?.parent === 'tata' && 'Dan sa Tatom'}
                    {scheduleData[activeModalDate]?.parent === 'mama' && 'Dan sa Mamom'}
                    {!scheduleData[activeModalDate]?.parent && 'Nije još određeno'}
                  </span>
                </div>
              )}

              {/* BELEŠKA / NAPOMENA */}
              <div style={styles.modalSection}>
                <label style={styles.inputLabel}>
                  {isAdmin ? 'Kratka napomena (aktivnosti, trening, rođendan):' : 'Zabeleška za ovaj dan:'}
                </label>

                {isAdmin ? (
                  <>
                    <textarea
                      value={modalNoteText}
                      onChange={(e) => setModalNoteText(e.target.value)}
                      placeholder="npr. Trening plivanja u 17h, lekarski pregled..."
                      rows={4}
                      style={styles.modalTextarea}
                      maxLength={200}
                    />
                    {/* Brzi tagovi za brzi unos */}
                    <div style={styles.quickTagsContainer}>
                      <span style={styles.quickTagsTitle}>Brzi predlozi:</span>
                      {['⚽ Trening', '🎒 Škola', '🎂 Rođendan', '🩺 Lekar', '🌳 Izlet', '🍿 Bioskop'].map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setModalNoteText(prev => prev ? `${prev}, ${tag}` : tag)}
                          style={styles.quickTagBtn}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={styles.readOnlyNoteBox}>
                    {modalNoteText ? (
                      <p style={styles.readOnlyNoteText}>{modalNoteText}</p>
                    ) : (
                      <p style={styles.noNotePlaceholder}>Nema dodatnih napomena za ovaj dan.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* DUGMAD U DNU MODALA */}
            <div style={styles.modalFooter}>
              {isAdmin ? (
                <>
                  {scheduleData[activeModalDate]?.note && (
                    <button
                      type="button"
                      onClick={handleDeleteNote}
                      style={styles.modalDeleteBtn}
                    >
                      Obriši belešku
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <button
                      type="button"
                      onClick={() => setActiveModalDate(null)}
                      style={styles.modalCancelBtn}
                    >
                      Otkaži
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveModal}
                      style={styles.modalSaveBtn}
                    >
                      Sačuvaj
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveModalDate(null)}
                  style={styles.modalCloseBtn}
                >
                  Zatvori
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL SA SUPABASE SQL SKRIPTOM I UPUTSTVOM */}
      {/* ======================================================== */}
      {showSqlModal && (
        <div style={styles.modalOverlay} onClick={() => setShowSqlModal(false)}>
          <div style={{ ...styles.modalDialog, maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Supabase SQL Editor Skripta</h3>
                <span style={styles.modalSubtitle}>Kopirajte i pokrenite u Supabase konzoli</span>
              </div>
              <button 
                onClick={() => setShowSqlModal(false)} 
                style={styles.modalCloseIcon}
              >
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              <p style={{ fontSize: '13px', color: '#475569', margin: '0 0 10px 0', lineHeight: 1.5 }}>
                Otvorite vaš projekat na <strong>supabase.com</strong> ➔ idite na <strong>SQL Editor</strong> ➔ nalepite sledeći SQL i kliknite <strong>Run</strong>:
              </p>

              <pre style={styles.sqlCodeBlock}>
                <code>{SUPABASE_SETUP_SQL}</code>
              </pre>

              <div style={{ marginTop: '12px', fontSize: '12px', color: '#64748b' }}>
                <p style={{ margin: '4px 0' }}>• Tabela: <strong>schedule</strong> (kolone: date, parent, note)</p>
                <p style={{ margin: '4px 0' }}>• RLS politike: omogućavaju javno čitanje detetu i upis roditeljima.</p>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
                  setCopiedSql(true);
                  setTimeout(() => setCopiedSql(false), 2000);
                }}
                style={styles.copySqlBtn}
              >
                {copiedSql ? '✓ Kopirano!' : '📋 Kopiraj SQL Skriptu'}
              </button>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                style={styles.modalCloseBtn}
              >
                Zatvori
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ==========================================
// INLINE CSS STILOVI (ZA MOBILNU PRILAGOĐENOST)
// ==========================================
const styles: Record<string, React.CSSProperties> = {
  outerContainer: {
    minHeight: '100vh',
    width: '100%',
    backgroundColor: '#f1f5f9',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '16px 12px 32px 12px',
    boxSizing: 'border-box',
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  mobileCard: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: '#ffffff',
    borderRadius: '24px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.03)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid #e2e8f0',
  },
  header: {
    padding: '20px 20px 14px 20px',
    borderBottom: '1px solid #f1f5f9',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px'
  },
  brandBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  titleText: {
    margin: 0,
    fontSize: '19px',
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.3px'
  },
  subtitleText: {
    margin: '2px 0 0 0',
    fontSize: '12px',
    color: '#64748b'
  },
  databaseBadge: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  adminBanner: {
    backgroundColor: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: '12px',
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  readOnlyBanner: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  bannerText: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#1e293b'
  },
  modeToggleLink: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#2563eb',
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  todayCard: {
    backgroundColor: '#f8fafc',
    borderRadius: '16px',
    padding: '12px 14px',
    border: '1px solid #e2e8f0',
  },
  todayLabel: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#64748b'
  },
  todayParentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '3px'
  },
  todayParentName: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a'
  },
  todayNoteButton: {
    backgroundColor: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#1e293b',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  legendRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
    paddingTop: '4px'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  legendDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    display: 'inline-block'
  },
  legendLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#475569'
  },
  adminTip: {
    fontSize: '11px',
    color: '#059669',
    fontWeight: 600,
    marginLeft: 'auto'
  },
  navContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    backgroundColor: '#ffffff'
  },
  navButton: {
    width: '38px',
    height: '38px',
    borderRadius: '12px',
    backgroundColor: '#f1f5f9',
    border: 'none',
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#334155',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.15s ease'
  },
  monthDisplay: {
    textAlign: 'center'
  },
  monthTitle: {
    margin: 0,
    fontSize: '17px',
    fontWeight: 800,
    color: '#0f172a'
  },
  todayJumpBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '11px',
    color: '#2563eb',
    fontWeight: 600,
    textDecoration: 'underline',
    cursor: 'pointer',
    marginTop: '2px',
    padding: 0
  },
  calendarWrapper: {
    padding: '0 14px 16px 14px'
  },
  weekDaysGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '4px',
    marginBottom: '6px',
    textAlign: 'center'
  },
  weekDayHeader: {
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 0'
  },
  daysGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '5px'
  },
  emptyCell: {
    aspectRatio: '1 / 1.1',
    backgroundColor: 'transparent'
  },
  dayCell: {
    aspectRatio: '1 / 1.15',
    borderRadius: '12px',
    borderStyle: 'solid',
    padding: '4px 3px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    position: 'relative',
    userSelect: 'none',
    boxSizing: 'border-box',
    transition: 'transform 0.1s ease, background-color 0.15s ease'
  },
  dayTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%'
  },
  dayNumber: {
    fontSize: '13px',
    lineHeight: 1,
    padding: '1px 2px'
  },
  noteBadge: {
    border: 'none',
    borderRadius: '6px',
    padding: '1px 2px',
    fontSize: '10px',
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  addNoteTinyBtn: {
    position: 'absolute',
    bottom: '2px',
    right: '2px',
    backgroundColor: 'rgba(0,0,0,0.06)',
    border: 'none',
    borderRadius: '4px',
    fontSize: '8px',
    padding: '1px 3px',
    cursor: 'pointer',
    color: '#334155'
  },
  dayCenterInfo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    flex: 1
  },
  parentNameBadge: {
    fontSize: '9px',
    fontWeight: 800,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    padding: '1px 4px',
    borderRadius: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.22)'
  },
  emptyDayPlaceholder: {
    fontSize: '12px',
    color: '#94a3b8',
    fontWeight: 500
  },
  saveToast: {
    margin: '0 16px 10px 16px',
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    color: '#ffffff',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: 600,
    textAlign: 'center'
  },
  footer: {
    padding: '12px 20px 20px 20px',
    borderTop: '1px solid #f1f5f9',
    backgroundColor: '#fafafa',
    textAlign: 'center'
  },
  footerText: {
    margin: 0,
    fontSize: '11px',
    color: '#64748b',
    lineHeight: 1.5
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px'
  },
  modalDialog: {
    backgroundColor: '#ffffff',
    borderRadius: '20px',
    width: '100%',
    maxWidth: '380px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  modalHeader: {
    padding: '18px 20px',
    borderBottom: '1px solid #f1f5f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  modalTitle: {
    margin: 0,
    fontSize: '17px',
    fontWeight: 800,
    color: '#0f172a'
  },
  modalSubtitle: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '2px',
    display: 'block'
  },
  modalCloseIcon: {
    backgroundColor: '#f1f5f9',
    border: 'none',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#64748b',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalBody: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  modalSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  inputLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#334155'
  },
  parentRadioGroup: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px'
  },
  parentSelectOption: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '10px 6px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s ease'
  },
  readOnlyParentBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    fontSize: '14px',
    color: '#1e293b'
  },
  modalTextarea: {
    width: '100%',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    padding: '10px 12px',
    fontSize: '14px',
    color: '#0f172a',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'none'
  },
  quickTagsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
    marginTop: '2px'
  },
  quickTagsTitle: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: 600
  },
  quickTagBtn: {
    backgroundColor: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer'
  },
  readOnlyNoteBox: {
    padding: '14px',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    minHeight: '70px',
    display: 'flex',
    alignItems: 'center'
  },
  readOnlyNoteText: {
    margin: 0,
    fontSize: '14px',
    color: '#1e293b',
    lineHeight: 1.5,
    fontWeight: 500
  },
  noNotePlaceholder: {
    margin: 0,
    fontSize: '13px',
    color: '#94a3b8',
    fontStyle: 'italic'
  },
  modalFooter: {
    padding: '14px 20px',
    borderTop: '1px solid #f1f5f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fafafa'
  },
  modalCancelBtn: {
    backgroundColor: '#f1f5f9',
    border: 'none',
    borderRadius: '10px',
    padding: '9px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#475569',
    cursor: 'pointer'
  },
  modalSaveBtn: {
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '10px',
    padding: '9px 18px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#ffffff',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)'
  },
  modalDeleteBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#e11d48',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0
  },
  modalCloseBtn: {
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '10px',
    padding: '9px 20px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#ffffff',
    cursor: 'pointer',
    marginLeft: 'auto'
  },
  sqlCodeBlock: {
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: '10px',
    padding: '12px',
    fontSize: '11px',
    lineHeight: 1.4,
    overflowX: 'auto',
    margin: 0,
    maxHeight: '190px'
  },
  copySqlBtn: {
    backgroundColor: '#10b981',
    border: 'none',
    borderRadius: '10px',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#ffffff',
    cursor: 'pointer'
  }
};
