const fs = require('node:fs');
const sourcePath = 'app/shift-create.tsx';
let source = fs.readFileSync(sourcePath, 'utf8');
const helperStart = source.indexOf('const ILLUSTRATION_COUNT = 114;');
const helperEnd = source.indexOf('const getStaffShiftColor', helperStart);
const helpers = source.slice(helperStart, helperEnd);
const exportStart = source.indexOf('  const exportPDF = async');
const bodyStart = source.indexOf('      const year = currentDate.getFullYear();', exportStart);
const bodyEnd = source.indexOf("      if (asImage && Platform.OS === 'web')", bodyStart);
if (helperStart < 0 || helperEnd < 0 || bodyStart < 0 || bodyEnd < 0) throw new Error('Extraction boundaries missing');
const builder = source.slice(bodyStart, bodyEnd)
  .replace(/, PRINT_SHIFT_COLORS\)/g, ')')
  .replace(/^      /gm, '  ');
const types = `type CalendarPrintOptions = {
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

`;
const signature = `export const buildCalendarPrintHtml = ({
  currentDate, printType, allStaff, assignedShifts, eventsData, publicHolidays,
  shiftPrintPhotos, getStaffOrder, getCalendarStaffColor,
}: CalendarPrintOptions) => {
`;
fs.writeFileSync('utils/buildCalendarPrintHtml.ts', types + helpers + signature + builder + '  return html;\n};\n');
source = source.slice(0, bodyStart) + `      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const html = buildCalendarPrintHtml({
        currentDate, printType, allStaff, assignedShifts, eventsData, publicHolidays,
        shiftPrintPhotos, getStaffOrder,
        getCalendarStaffColor: (name, index) => getCalendarStaffColor(name, index, PRINT_SHIFT_COLORS),
      });

` + source.slice(bodyEnd);
source = source.replace(helpers, '');
source = source.replace("import ShiftScreen from './shift';", "import ShiftScreen from './shift';\nimport { buildCalendarPrintHtml } from '../utils/buildCalendarPrintHtml';");
fs.writeFileSync(sourcePath, source);
