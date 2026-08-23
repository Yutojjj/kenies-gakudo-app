/**
 * Copy only September 2026 assigned_shifts documents from a PITR clone.
 *
 * Usage:
 *   node restore-september-shifts.js --source=default-clone
 *   node restore-september-shifts.js --source=default-clone --apply
 *
 * Firebase Admin credentials are taken from Google Application Default
 * Credentials (for example, Cloud Shell or `gcloud auth application-default login`).
 */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const SOURCE_DB = process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1] || 'default-clone';
const APPLY = process.argv.includes('--apply');
const DATE_PATTERN = /^2026-09-(0[1-9]|[12][0-9]|30)$/;

const app = initializeApp();
const source = getFirestore(app, SOURCE_DB);
const target = getFirestore(app, '(default)');

async function main() {
  const snapshot = await source.collection('assigned_shifts').get();
  const docs = snapshot.docs.filter((doc) => DATE_PATTERN.test(doc.id));

  console.log(`対象: ${docs.length}日分`);
  console.log(docs.map((doc) => doc.id).sort().join(', ') || '(なし)');

  if (!APPLY) {
    console.log('確認モードです。実際にコピーする場合は --apply を付けて実行してください。');
    return;
  }

  for (let i = 0; i < docs.length; i += 400) {
    const batch = target.batch();
    docs.slice(i, i + 400).forEach((doc) => {
      batch.set(target.collection('assigned_shifts').doc(doc.id), doc.data(), { merge: true });
    });
    await batch.commit();
  }

  console.log(`${docs.length}日分を本番データベースへコピーしました。`);
}

main().catch((error) => {
  console.error('復元に失敗しました:', error.message || error);
  process.exitCode = 1;
});
