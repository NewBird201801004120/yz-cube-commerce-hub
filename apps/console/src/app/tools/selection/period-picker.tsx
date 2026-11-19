'use client';

import {useId, useRef, useState} from 'react';
import {addDays, dateAt, dayKey, periodLabel, periodNames, weekNumber, type Period, type PeriodType} from '@/lib/selection';
import styles from './selection.module.css';

const types = ['day', 'week', 'month'] as const;
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const prompts = {day: '选择日期', week: '选择周', month: '选择月份'};
const malaysiaDate = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export function PeriodPicker({value, onChange, clearable}: {
  value: Period | null; onChange: (period: Period | null) => void; clearable?: boolean;
}) {
  const [type, setType] = useState<PeriodType>(value?.type ?? 'day');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => dateAt(value?.value ?? malaysiaDate()));
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const activeType = open ? type : value?.type ?? type;
  const selectedValue = value?.type === activeType ? value.value : undefined;
  const year = cursor.getUTCFullYear(), month = cursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const start = addDays(first, -((first.getUTCDay() + 6) % 7));
  const weeks = Array.from({length: 6}, (_, index) => addDays(start, index * 7));

  function pick(value: string) {
    onChange({type: activeType, value});
    setOpen(false);
    trigger.current?.focus();
  }

  function move(delta: number) {
    if (activeType === 'month') setCursor(new Date(Date.UTC(year + delta, month, 1)));
    else setCursor(new Date(Date.UTC(year, month + delta, 1)));
  }

  return <div className={styles.period} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }}>
    <div className={styles.periodControls}>
      <div role="group" aria-label="统计周期" className={styles.periodTypes}>
        {types.map(tab => <button key={tab} type="button" aria-pressed={tab === activeType} onClick={() => {
          if (tab !== activeType && !clearable) onChange(null);
          setType(tab);
          if (!open && value) setCursor(dateAt(value.value));
          setOpen(true);
        }}>{periodNames[tab].slice(0, 1)}</button>)}
      </div>
      <button type="button" className={styles.dateTrigger} aria-expanded={open} aria-controls={open ? id : undefined} ref={trigger} onClick={() => {
        if (!open) {
          setType(activeType);
          if (value) setCursor(dateAt(value.value));
        }
        setOpen(!open);
      }}>{selectedValue ? periodLabel({type: activeType, value: selectedValue}) : prompts[activeType]} <span aria-hidden="true">▾</span></button>
      {clearable && value && <button type="button" className={styles.textButton} onClick={() => {
        setType(activeType);
        setOpen(false);
        onChange(null);
      }}>全部日期</button>}
    </div>
    {open && <div id={id} className={styles.calendar} role="group" aria-label={prompts[activeType]}>
      <div className={styles.calendarHeader}>
        <button type="button" aria-label={activeType === 'month' ? '上一年' : '上个月'} disabled={year === 2000 && (activeType === 'month' || month === 0)} onClick={() => move(-1)}>‹</button>
        <strong aria-live="polite">{year} 年{activeType !== 'month' && ` ${month + 1} 月`}</strong>
        <button type="button" aria-label={activeType === 'month' ? '下一年' : '下个月'} disabled={year === 9999 && (activeType === 'month' || month === 11)} onClick={() => move(1)}>›</button>
      </div>
      {activeType === 'month' ? <div className={styles.months}>
        {Array.from({length: 12}, (_, index) => {
          const key = `${year}-${String(index + 1).padStart(2, '0')}`;
          return <button key={key} type="button" aria-label={key} aria-pressed={selectedValue === key} onClick={() => pick(key)}>{index + 1}月</button>;
        })}
      </div> : <div className={activeType === 'week' ? styles.weekCalendar : styles.dayCalendar}>
        <div className={styles.weekdays} aria-hidden="true">
          {activeType === 'week' && <span>周</span>}
          {weekdays.map(day => <span key={day}>{day}</span>)}
        </div>
        {weeks.map(week => activeType === 'week' ? <button key={dayKey(week)} className={styles.week} type="button"
          aria-label={periodLabel({type: 'week', value: dayKey(week)})} aria-pressed={selectedValue === dayKey(week)}
          disabled={week.getUTCFullYear() < 2000 || week.getUTCFullYear() > 9999} onClick={() => pick(dayKey(week))}>
          <span>{weekNumber(week)}</span>
          {weekdays.map((day, index) => {
            const date = addDays(week, index);
            return <span key={day} className={date.getUTCMonth() === month ? undefined : styles.otherMonth}>{date.getUTCDate()}</span>;
          })}
        </button> : <div key={dayKey(week)} className={styles.days}>
          {weekdays.map((weekday, index) => {
            const date = addDays(week, index);
            const key = dayKey(date);
            return <button key={weekday} type="button" aria-label={key} aria-pressed={selectedValue === key}
              className={date.getUTCMonth() === month ? undefined : styles.otherMonth}
              disabled={date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 9999} onClick={() => pick(key)}>{date.getUTCDate()}</button>;
          })}
        </div>)}
      </div>}
    </div>}
  </div>;
}
