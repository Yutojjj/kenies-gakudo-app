export type PeriodLesson = {
  isExternal?: boolean;
  validFrom?: string;
  validTo?: string;
};

export function isLessonActiveOnDate(lesson: PeriodLesson, dateKey: string): boolean {
  if (!lesson.isExternal) return true;
  if (lesson.validFrom && dateKey < lesson.validFrom) return false;
  if (lesson.validTo && dateKey > lesson.validTo) return false;
  return true;
}
