type CalendarPrintOptions = {
  currentDate: Date;
  printType: 'shift' | 'event';
  allStaff: { id: string; name: string }[];
  assignedShifts: Record<string, { name: string; start: string; end: string }[]>;
  eventsData: Record<string, string[]>;
  publicHolidays: Record<string, string>;
  shiftPrintPhotos: { url: string }[];
  getStaffOrder: () => string[];
  getCalendarStaffColor: (name: string, index: number) => string;
};

const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

const ILLUSTRATION_COUNT = 114;

const getMonthTitleColor = (month: number) => {
  const progress = ((month - 3 + 12) % 12) / 11;
  const stops = [
    { at: 0, color: [232, 104, 154] }, // 3月: ピンク
    { at: 0.28, color: [241, 199, 68] }, // 黄色
    { at: 0.52, color: [151, 204, 78] }, // 黄緑
    { at: 0.76, color: [79, 193, 179] }, // 緑がかった水色
    { at: 1, color: [137, 205, 232] }, // 2月: 淡い水色
  ];
  const upperIndex = stops.findIndex(stop => progress <= stop.at);
  const upper = stops[upperIndex < 0 ? stops.length - 1 : upperIndex];
  const lower = stops[Math.max(0, (upperIndex < 0 ? stops.length - 1 : upperIndex) - 1)];
  const localProgress = upper.at === lower.at ? 0 : (progress - lower.at) / (upper.at - lower.at);
  const rgb = lower.color.map((value, index) => Math.round(value + (upper.color[index] - value) * localProgress));
  return `rgb(${rgb.join(',')})`;
};

export const buildCalendarPrintHtml = ({
  currentDate, printType, allStaff, assignedShifts, eventsData, publicHolidays,
  shiftPrintPhotos, getStaffOrder, getCalendarStaffColor,
}: CalendarPrintOptions) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
  const DOW = ['日','月','火','水','木','金','土'];

  const weeks: ({day:number, dow:number, dateStr:string} | null)[][] = [];
  let week: ({day:number, dow:number, dateStr:string} | null)[] = [];
  const firstDow = new Date(year, month - 1, 1).getDay();
  for (let p = 0; p < firstDow; p++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    week.push({ day: d, dow, dateStr: ds });
    if (dow === 6 || d === daysInMonth) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
      week = [];
    }
  }

  const dowHeader = `<tr>
    ${DOW.map((d,i) => {
      const cls = i===0 ? 'c-dow c-dow-sun' : i===6 ? 'c-dow c-dow-sat' : 'c-dow c-dow-week';
      return `<td class="${cls}">${d}</td>`;
    }).join('')}
  </tr>`;

  let bodyHtml = '';
  const orderedStaff: typeof allStaff = getStaffOrder()
    .map(name => allStaff.find(staff => staff.name === name))
    .filter((staff): staff is typeof allStaff[0] => !!staff);
  const illustrationPool = Array.from({ length: ILLUSTRATION_COUNT }, (_, index) => index + 1)
    .sort(() => Math.random() - 0.5);
  const nextIllustration = () => `/illustrations/${illustrationPool.shift() || Math.floor(Math.random() * ILLUSTRATION_COUNT) + 1}.png`;
  // イベント印刷では、月初・月末の「日付がないセル」にだけ写真を配置する。
  const emptyCellImages = (printType === 'event' || printType === 'shift')
    ? weeks.flat()
        .filter(cell => !cell)
        .map(() => printType === 'event' && shiftPrintPhotos.length > 0
          ? shiftPrintPhotos[Math.floor(Math.random() * shiftPrintPhotos.length)].url
          : nextIllustration())
    : [];
  const illustrationByDate = new Map(
    (printType === 'event' || printType === 'shift')
      ? weeks.flat()
          .filter((cell): cell is { day: number; dow: number; dateStr: string } => !!cell)
          .filter(cell => printType === 'event' || (assignedShifts[cell.dateStr] || []).length === 0)
          .map(cell => [cell.dateStr, nextIllustration()])
      : [],
  );
  const fifthWeekdayAnchor = printType === 'event'
    ? weeks.flat()
        .filter((cell): cell is { day: number; dow: number; dateStr: string } => !!cell && cell.dow >= 1 && cell.dow <= 5 && cell.day > 28)
        .sort((a, b) => a.day - b.day)[0]
    : null;
  const fifthWeekdayEnd = fifthWeekdayAnchor
    ? weeks.find(wk => wk.some(cell => cell?.dateStr === fifthWeekdayAnchor.dateStr))
        ?.filter((cell): cell is { day: number; dow: number; dateStr: string } => !!cell && cell.dow >= 1 && cell.dow <= 5 && cell.day > 28)
        .sort((a, b) => a.dow - b.dow)
        .slice(-1)[0]
    : null;
  const fifthWeekdayBandWidth = fifthWeekdayAnchor && fifthWeekdayEnd
    ? Math.max(1, fifthWeekdayEnd.dow - fifthWeekdayAnchor.dow + 1)
    : 1;

  let emptyCellImageIndex = 0;
  weeks.forEach(wk => {
    const maxDayEntries = Math.max(0, ...wk.map(cell => {
      if (!cell) return 0;
      const eventRows = (eventsData[cell.dateStr] || []).reduce(
        (total, title) => total + Math.max(1, Math.ceil(Array.from(String(title)).length / 16)),
        0,
      );
      const fifthWeekdayNoteRows = fifthWeekdayAnchor?.dateStr === cell.dateStr ? 1 : 0;
      return eventRows + fifthWeekdayNoteRows + (printType === 'shift' ? (assignedShifts[cell.dateStr] || []).length : 0);
    }));
    // 内容が少ない週は詰め、行内の最大件数に応じて必要な分だけ高さを増やす。
    const weekHeightMm = printType === 'event'
      ? (weeks.length >= 6 ? 29 : 34)
      : Math.min(38, Math.max(16, 9 + maxDayEntries * 4.6));
    const cells = wk.map(cell => {
      if (!cell) {
        const image = emptyCellImages[emptyCellImageIndex++];
        const decoration = image ? `<img class="calendar-empty-photo" src="${image}" alt="" />` : '';
        return `<td class="calendar-day calendar-day-empty" style="height:${weekHeightMm}mm"><div class="calendar-cell-shell">${decoration}</div></td>`;
      }
      const isSun = cell.dow === 0;
      const isSat = cell.dow === 6;
      const isPH = !!publicHolidays[cell.dateStr];
      const dayClass = isPH || isSun ? 'calendar-day calendar-day-sun' : isSat ? 'calendar-day calendar-day-sat' : 'calendar-day';
      const fifthWeekdayNote = fifthWeekdayAnchor?.dateStr === cell.dateStr
        ? `<div class="calendar-closure-band" style="width:${fifthWeekdayBandWidth}00%">スイミングお休み</div>`
        : '';
      const eventEntries = (eventsData[cell.dateStr] || []).map(title => (
        `<div class="calendar-event">${title}</div>`
      )).join('');
      const isClosureRangeCell = !!fifthWeekdayAnchor && !!fifthWeekdayEnd
        && cell.dow >= fifthWeekdayAnchor.dow
        && cell.dow <= fifthWeekdayEnd.dow
        && cell.day >= fifthWeekdayAnchor.day
        && cell.day <= fifthWeekdayEnd.day;
      const eventContainerClass = isClosureRangeCell ? 'calendar-events calendar-events-with-closure' : 'calendar-events';
      const entries = printType === 'shift' ? orderedStaff.map((staff, staffIndex) => {
        const assigned = assignedShifts[cell.dateStr]?.find((s: any) => s.name === staff.name);
        if (!assigned) return '';
        const color = getCalendarStaffColor(staff.name, Math.max(0, allStaff.findIndex(item => item.name === staff.name)));
        const compactTextLength = Array.from(`${staff.name}　${assigned.start}〜${assigned.end}`).length;
        const useStackedShift = staff.name.length >= 5 || compactTextLength > 14;
        return `<div class="calendar-shift" style="background-color:${color} !important;">
          ${useStackedShift
            ? `<span class="calendar-shift-name">${staff.name}</span><span class="calendar-shift-time">${assigned.start}〜${assigned.end}</span>`
            : `<span class="calendar-shift-line">${staff.name}　${assigned.start}〜${assigned.end}</span>`}
        </div>`;
      }).filter(Boolean).join('') : '';
      const illustration = illustrationByDate.get(cell.dateStr);
      const decoration = illustration
        ? `<img class="calendar-illustration" src="${illustration}" alt="" />`
        : '';
      const holidayLabel = printType === 'event' && publicHolidays[cell.dateStr]
        ? `<span class="calendar-holiday-label">${publicHolidays[cell.dateStr]}</span>`
        : '';
      return `<td class="${dayClass}" style="height:${weekHeightMm}mm"><div class="calendar-cell-shell">${decoration}<div class="calendar-cell-content"><div class="calendar-date-row"><span class="calendar-date">${cell.day}</span>${holidayLabel}</div>${fifthWeekdayNote}<div class="${eventContainerClass}">${eventEntries}</div><div class="calendar-shifts">${entries}</div></div></div></td>`;
    }).join('');
    bodyHtml += `<tr>${cells}</tr>`;
  });

  const titleIllustrationLeft = nextIllustration();
  const titleIllustrationRight = nextIllustration();
  const monthTitleColor = getMonthTitleColor(month);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: A4 ${printType === 'event' ? 'landscape' : 'portrait'}; margin: 4mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Hiragino Kaku Gothic ProN', 'Meiryo', Arial, sans-serif;
      font-size: 8px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; page-break-inside: avoid; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    td { border: 0.5px solid #AAAAAA; vertical-align: middle; text-align: center; }

    .c-dow { font-weight: 900; font-size: 11px; line-height: 1.1; padding: 1.5mm 1px; }
    .c-dow-week { background-color: #E8E8E8 !important; color: #333; }
    .c-dow-sun  { background-color: #FFD9D9 !important; color: #CC0000; }
    .c-dow-sat  { background-color: #CCE4FF !important; color: #0055CC; }

    caption { caption-side: top; height: 15mm; text-align: center; font-size: 19px; line-height: 15mm; font-weight: 900; padding: 0; margin-bottom: 1.5mm; color: #216E77; background: #C8E9EB; border: 1px solid #8FCED2; clip-path: polygon(0 0, 100% 0, 97% 50%, 100% 100%, 0 100%, 3% 50%); }
    caption img { width: 12mm; height: 12mm; object-fit: contain; vertical-align: middle; margin: 0 4mm; }
    .caption-month { display: inline-block; margin: 0 1.5mm; color: #155B64; font-size: 40px; line-height: 1; font-weight: 1000; vertical-align: middle; }
    .calendar-day { height: 16mm; vertical-align: top; text-align: left; padding: 0; background: #FFFFFF !important; }
    .calendar-cell-shell { position: relative; width: 100%; height: 100%; min-height: 16mm; overflow: visible; }
    .calendar-cell-content { position: relative; z-index: 1; }
    .calendar-illustration { position: absolute; z-index: 0; right: 1.5mm; bottom: 1mm; width: 14mm; height: 14mm; object-fit: contain; opacity: 0.38; pointer-events: none; }
    .calendar-empty-photo { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0.38; pointer-events: none; }
    .calendar-day-empty { background: #FFFFFF !important; }
    .calendar-day-short { height: 16mm; }
    .calendar-day-sun { background: #FFF1F1 !important; }
    .calendar-day-sat { background: #F0F7FF !important; }
    .calendar-date { font-weight: 900; font-size: 16px; line-height: 1; padding: 1.5mm 1.5mm 0; margin-bottom: 1.5mm; }
    .calendar-day-sun .calendar-date { color: #D94747; }
    .calendar-day-sat .calendar-date { color: #2874C6; }
    .calendar-events { display: flex; flex-direction: column; gap: 0.5mm; margin-bottom: 0; width: 100%; }
    .calendar-events-with-closure { margin-top: 5mm; }
    .calendar-event { width: 100%; border-radius: 0; padding: 1.2mm 1.5mm; background: #E9B92F !important; color: #2D2100; font-size: 10px; line-height: 1.15; font-weight: 900; text-align: center; white-space: normal; overflow-wrap: anywhere; }
    .calendar-date-row { display: flex; align-items: baseline; gap: 1.5mm; padding: 1.5mm 1.5mm 0; min-height: 5mm; }
    .calendar-date-row .calendar-date { padding: 0; margin: 0; }
    .calendar-holiday-label { color: #D94747; font-size: 9px; line-height: 1.1; font-weight: 900; white-space: normal; overflow-wrap: anywhere; }
    .calendar-closure-band { position: absolute; z-index: 2; top: 6mm; left: 0; width: 100%; border-radius: 0; padding: 1.2mm 1.5mm; background: #DCE9F7 !important; color: #244C73; font-size: 10px; line-height: 1.15; font-weight: 900; text-align: center; white-space: nowrap; overflow: hidden; }
    .calendar-shifts { width: 100%; display: flex; flex-direction: column; gap: 0; }
    .calendar-shift { width: 100%; border-radius: 0; padding: 1.1mm 1.5mm; font-size: 9px; line-height: 1.12; color: #111; white-space: nowrap; overflow: hidden; font-weight: 900; }
    .calendar-shift-line { display: block; width: 100%; white-space: nowrap; overflow: hidden; font-weight: 900; font-size: 9px; letter-spacing: 0; }
    .calendar-shift-name, .calendar-shift-time { display: block; white-space: nowrap; overflow: hidden; font-weight: 900; }
    .calendar-shift-name { font-size: 10px; }
    .calendar-shift-time { font-size: 9px; }

    .legend { display: none; }
    .lb { display: inline-block; width: 10px; height: 10px; border: 0.5px solid #aaa; vertical-align: middle; margin-right: 2px; }
  </style></head><body>
    <table>
      <caption><img src="${titleIllustrationLeft}" alt="" /><span>${year}年</span><span class="caption-month" style="color:${monthTitleColor};">${month}月</span><span>${printType === 'event' ? 'カレンダー' : 'シフト表'}</span><img src="${titleIllustrationRight}" alt="" /></caption>
      <thead>${dowHeader}</thead>
      <tbody>${bodyHtml}</tbody>
    </table>
    <div class="legend">
      <span><span class="lb" style="background:#FFD700;"></span>出勤（時間）</span>
      <span><span class="lb" style="background:#D0D0D0;"></span>× 出勤不可 / 未回答</span>
      <span><span class="lb" style="background:#FFD9D9;"></span>日曜・祝日</span>
      <span><span class="lb" style="background:#CCE4FF;"></span>土曜</span>
    </div>
  </body></html>`;

  return html;
};
