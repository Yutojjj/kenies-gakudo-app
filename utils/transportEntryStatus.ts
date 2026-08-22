export type TransportEntryStatus = 'complete' | 'partial' | 'empty';

type TransportAttendance = {
  schools?: Record<string, Record<string, any[]>>;
  lessons?: Record<string, any[]>;
};

export const getTransportEntryStatus = (
  attendance: TransportAttendance,
  savedData: Record<string, any> | undefined,
): TransportEntryStatus => {
  if (!savedData) return 'empty';

  const expectedBlockKeys = new Set<string>();
  Object.entries(attendance.schools || {}).forEach(([school, times]) => {
    Object.keys(times).forEach(time => expectedBlockKeys.add(`${school}_${time}`));
  });
  Object.keys(attendance.lessons || {}).forEach(lessonKey => expectedBlockKeys.add(lessonKey));

  try {
    const customBlocks = typeof savedData.customBlocks === 'string'
      ? JSON.parse(savedData.customBlocks)
      : savedData.customBlocks;
    if (Array.isArray(customBlocks)) {
      customBlocks.forEach((block: any) => {
        const id = String(block?.id || '').trim();
        if (id) expectedBlockKeys.add(id);
      });
    }
  } catch {}

  const assignedBlockKeys = new Set<string>();
  try {
    const parsed = typeof savedData.entries === 'string'
      ? JSON.parse(savedData.entries)
      : savedData.entries;
    if (Array.isArray(parsed?.entries)) {
      parsed.entries.forEach((entry: any) => {
        if (!Array.isArray(entry?.trips)) return;
        entry.trips.forEach((trip: any) => {
          const blockKeys = Array.isArray(trip?.blockKeys)
            ? trip.blockKeys
            : trip?.blockKey ? [trip.blockKey] : [];
          blockKeys.forEach((blockKey: any) => {
            const key = String(blockKey || '').trim();
            if (key) assignedBlockKeys.add(key);
          });
        });
      });
    }
  } catch {}

  if (assignedBlockKeys.size === 0) {
    const hasLegacyEntry = Object.entries(savedData).some(([key, value]) =>
      key !== 'entries' && key !== 'customBlocks' && typeof value === 'string' && value.trim().length > 0
    );
    return hasLegacyEntry ? 'complete' : 'empty';
  }

  if (expectedBlockKeys.size === 0) return 'complete';
  const assignedExpectedCount = [...expectedBlockKeys].filter(key => assignedBlockKeys.has(key)).length;
  return assignedExpectedCount >= expectedBlockKeys.size ? 'complete' : 'partial';
};
