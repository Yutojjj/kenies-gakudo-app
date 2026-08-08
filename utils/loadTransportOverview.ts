import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export type TransportOverviewData = {
  attendance: {
    schools: Record<string, Record<string, any[]>>;
    lessons: Record<string, any[]>;
    totalCount: number;
  };
  shiftStaff: any[];
  staffNames: string[];
  publicHolidays: Record<string, string>;
};

export async function loadTransportOverview(dateStr: string): Promise<TransportOverviewData> {
  const [accountSnap, scheduleSnap, schoolTimeSnap, lessonSnap, shiftSnap, holidaySnap, publicHolidayResult] = await Promise.all([
    getDocs(collection(db, 'accounts')),
    getDocs(query(collection(db, 'schedules2'), where('dateStr', '==', dateStr))),
    getDocs(collection(db, 'school_times')),
    getDocs(collection(db, 'lessons')),
    getDoc(doc(db, 'assigned_shifts', dateStr)),
    getDoc(doc(db, 'settings', 'holidays_data')),
    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(response => response.ok ? response.json() : {})
      .catch(() => ({})),
  ]);

  const publicHolidays = publicHolidayResult as Record<string, string>;
  const shiftStaff = shiftSnap.exists() ? (shiftSnap.data().staff || []) : [];
  const scheduleMap: Record<string, any> = {};
  scheduleSnap.forEach(scheduleDoc => {
    const item = scheduleDoc.data();
    if (item.childId && item.dateStr) scheduleMap[`${item.childId}_${item.dateStr}`] = item;
  });

  const schoolTimes: Record<string, any> = {};
  schoolTimeSnap.forEach(timeDoc => { schoolTimes[timeDoc.id] = timeDoc.data(); });
  const regularLessons = lessonSnap.docs.map(lessonDoc => ({ id: lessonDoc.id, ...lessonDoc.data() } as any));
  const holidayPeriods = holidaySnap.exists() ? (holidaySnap.data().periods || []) : [];
  const children: any[] = [];
  const staffNames: string[] = [];

  accountSnap.forEach(accountDoc => {
    const data = accountDoc.data();
    const parentId = accountDoc.id;
    if ((data.role === 'staff' || data.role === 'admin') && data.name) staffNames.push(data.name);

    if (data.role === 'staff' && data.hasChild) {
      if (Array.isArray(data.staffChildren) && data.staffChildren.length > 0) {
        data.staffChildren.forEach((child: any, index: number) => children.push({
          id: `${parentId}_${child.id || `staffchild_${index}`}`,
          name: child.name,
          school: child.school || '',
          grade: child.grade || '',
          usageType: '定期利用',
          days: { 月: true, 火: true, 水: true, 木: true, 金: true },
          isStaffChild: true,
          parentName: data.name,
        }));
      } else if (data.childName) {
        children.push({
          id: `${parentId}_staffchild_0`,
          name: data.childName,
          school: data.childSchool || '',
          grade: data.childGrade || '',
          usageType: '定期利用',
          days: { 月: true, 火: true, 水: true, 木: true, 金: true },
          isStaffChild: true,
          parentName: data.name,
        });
      }
    } else if (data.role === 'user') {
      if (data.school) children.push({
        id: parentId,
        name: data.name,
        school: data.school,
        grade: data.grade,
        usageType: data.usageType || '定期利用',
        days: data.days || {},
      });
      if (Array.isArray(data.siblings)) data.siblings.forEach((sibling: any, index: number) => {
        if (!sibling.school) return;
        children.push({
          id: sibling.id || `${parentId}_sib_${index}`,
          name: sibling.name,
          school: sibling.school,
          grade: sibling.grade,
          usageType: sibling.usageType || '定期利用',
          days: sibling.days || {},
        });
      });
    }
  });

  const selectedDate = new Date(`${dateStr}T00:00:00`);
  const dayName = DAY_NAMES[selectedDate.getDay()];
  const isHolidayPeriod = holidayPeriods.some((period: any) => dateStr >= period.start && dateStr <= period.end);
  const isPublicHoliday = !!publicHolidays[dateStr];
  const schools: Record<string, Record<string, any[]>> = {};
  const lessons: Record<string, any[]> = {};
  let totalCount = 0;

  children.forEach(child => {
    const override = scheduleMap[`${child.id}_${dateStr}`];
    let pickupTime: string | null = null;
    if (override && override.pickupTime !== undefined) {
      pickupTime = override.pickupTime;
    } else if (!isHolidayPeriod && !isPublicHoliday && dayName !== '日' && dayName !== '土') {
      if (child.isStaffChild) {
        if (shiftStaff.some((staff: any) => staff.name === child.parentName)) {
          pickupTime = schoolTimes[child.school]?.[child.grade]?.[dayName] || null;
        }
      } else if (child.usageType === '定期利用' && child.days?.[dayName]) {
        pickupTime = schoolTimes[child.school]?.[child.grade]?.[dayName] || null;
      } else if (child.usageType !== '定期利用' && override) {
        pickupTime = override.pickupTime || schoolTimes[child.school]?.[child.grade]?.[dayName] || null;
      }
    }

    if (pickupTime) {
      totalCount += 1;
      if (!schools[child.school]) schools[child.school] = {};
      if (!schools[child.school][pickupTime]) schools[child.school][pickupTime] = [];
      schools[child.school][pickupTime].push(child);
    }

    const overrideLessons = Array.isArray(override?.lessons)
      ? override.lessons
      : override?.lesson ? [override.lesson] : [];
    const regularLesson = regularLessons.find((lesson: any) => lesson.childId === child.id && lesson.dayOfWeek === dayName);
    const childLessons = overrideLessons.length > 0
      ? overrideLessons
      : regularLesson ? [{ name: regularLesson.lessonName, time: regularLesson.lessonTime }] : [];
    childLessons.forEach((lesson: any) => {
      if (!lesson?.name || !lesson?.time) return;
      const key = `${lesson.time} ${lesson.name}`;
      if (!lessons[key]) lessons[key] = [];
      lessons[key].push(child);
    });
  });

  return {
    attendance: { schools, lessons, totalCount },
    shiftStaff,
    staffNames: Array.from(new Set(staffNames)),
    publicHolidays,
  };
}
