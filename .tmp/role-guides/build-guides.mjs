import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const root = path.resolve('.tmp/role-guides');
const assets = path.join(root, 'assets');
const output = path.join(root, 'output');
const W = 1280;
const H = 720;

async function blob(file) {
  const bytes = await fs.readFile(path.join(assets, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const imageBytes = {
  logo: await blob('logo.png'),
  home: await blob('pickup-home.png'),
  attendance: await blob('attendance.png'),
  pickup: await blob('pickup.png'),
  shift: await blob('shift.png'),
  messages: await blob('messages.png'),
  changes: await blob('schedule-changes.png'),
  quickMenu: await blob('quick-menu-popup.png'),
  dateSelector: await blob('date-selector.png'),
};

function box(slide, x, y, w, h, fill = '#FFFFFF', line = '#D9E1E3', radius = 'rounded-xl') {
  return slide.shapes.add({ geometry: 'roundRect', position: { left: x, top: y, width: w, height: h }, fill, line: { style: 'solid', fill: line, width: 1 }, borderRadius: radius });
}
function text(slide, value, x, y, w, h, size, color = '#253033', bold = false, align = 'left') {
  const item = slide.shapes.add({ geometry: 'textbox', position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { style: 'solid', fill: 'none', width: 0 } });
  item.text = value;
  item.text.style = { fontFace: 'Arial', fontSize: size, color, bold, alignment: align, margin: 0, verticalAlignment: 'middle' };
  return item;
}
function image(slide, item, x, y, w, h, fit = 'contain') {
  return slide.images.add({ blob: item, contentType: 'image/png', alt: 'Kanyes app screen or icon', fit, position: { left: x, top: y, width: w, height: h }, geometry: 'roundRect', borderRadius: 'rounded-xl' });
}
function pageChrome(slide, role, accent, page) {
  slide.background.fill = '#FBFCFC';
  slide.shapes.add({ geometry: 'rect', position: { left: 0, top: 0, width: 18, height: H }, fill: accent, line: { style: 'solid', fill: accent, width: 0 } });
  text(slide, `ケーニーズ学童クラブ  |  ${role}ガイド`, 64, 30, 780, 28, 15, '#657276', true);
  text(slide, String(page).padStart(2, '0'), 1150, 30, 66, 28, 15, accent, true, 'right');
}
function cover(deck, role, accent, subtitle) {
  const slide = deck.slides.add();
  slide.background.fill = '#FBFCFC';
  slide.shapes.add({ geometry: 'rect', position: { left: 0, top: 0, width: 34, height: H }, fill: accent, line: { style: 'solid', fill: accent, width: 0 } });
  image(slide, imageBytes.logo, 84, 84, 106, 106);
  text(slide, 'ケーニーズ学童クラブ', 84, 238, 680, 52, 29, '#657276', true);
  text(slide, `${role}用\nかんたんガイド`, 84, 304, 650, 178, 72, '#253033', true);
  text(slide, subtitle, 90, 518, 600, 48, 24, '#4C5A5E');
  box(slide, 790, 82, 382, 554, '#FFFFFF', '#D9E1E3');
  image(slide, imageBytes.home, 824, 110, 314, 480, 'contain');
  text(slide, '毎日の画面を見ながら、必要な操作だけ確認できます。', 795, 604, 370, 24, 15, '#657276', false, 'center');
}
function homeSlide(deck, role, accent, headline, points) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, 2);
  text(slide, headline, 64, 82, 1080, 56, 39, '#253033', true);
  text(slide, 'まずはホームを開き、今日やることを上から確認します。', 64, 148, 840, 32, 21, '#657276');
  box(slide, 64, 212, 548, 430, '#FFFFFF', '#D9E1E3');
  image(slide, imageBytes.home, 90, 232, 496, 385, 'contain');
  const ys = [235, 350, 465];
  points.forEach((point, i) => {
    text(slide, `0${i + 1}`, 680, ys[i], 50, 34, 23, accent, true);
    text(slide, point.title, 748, ys[i] - 2, 390, 34, 24, '#253033', true);
    text(slide, point.body, 748, ys[i] + 38, 400, 48, 18, '#657276');
    if (i < points.length - 1) slide.shapes.add({ geometry: 'rect', position: { left: 680, top: ys[i] + 101, width: 440, height: 1 }, fill: '#D9E1E3', line: { style: 'solid', fill: '#D9E1E3', width: 0 } });
  });
}
function actionsSlide(deck, role, accent, headline, actions) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, 3);
  text(slide, headline, 64, 82, 1080, 56, 39, '#253033', true);
  text(slide, 'アイコンを押すと、それぞれの画面へ移動します。', 64, 148, 900, 32, 21, '#657276');
  actions.forEach((action, i) => {
    const x = 64 + i * 285;
    box(slide, x, 236, 240, 320, '#FFFFFF', '#D9E1E3');
    image(slide, imageBytes[action.icon], x + 70, 270, 100, 100, 'contain');
    text(slide, action.title, x + 20, 396, 200, 34, 23, '#253033', true, 'center');
    text(slide, action.body, x + 26, 447, 188, 70, 17, '#657276', false, 'center');
  });
}
function flowSlide(deck, role, accent, title, steps, close) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, 4);
  text(slide, title, 64, 82, 1050, 56, 39, '#253033', true);
  text(slide, '困ったときは、この順番で確認すると整理しやすくなります。', 64, 148, 940, 32, 21, '#657276');
  steps.forEach((step, i) => {
    const x = 64 + i * 286;
    text(slide, `0${i + 1}`, x, 240, 92, 82, 56, accent, true);
    slide.shapes.add({ geometry: 'rect', position: { left: x, top: 333, width: 200, height: 5 }, fill: accent, line: { style: 'solid', fill: accent, width: 0 } });
    text(slide, step.title, x, 365, 235, 34, 24, '#253033', true);
    text(slide, step.body, x, 416, 224, 76, 18, '#657276');
  });
  box(slide, 64, 568, 1080, 72, '#F2FBFA', accent);
  text(slide, close, 88, 584, 1020, 36, 22, '#253033', true, 'center');
}

async function save(deck, name) {
  const file = await PresentationFile.exportPptx(deck);
  await file.save(path.join(output, name));
}

await fs.mkdir(output, { recursive: true });

function contentsSlide(deck, role, accent, sections) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, 2);
  text(slide, 'この手順書でできること', 64, 82, 1000, 56, 39, '#253033', true);
  text(slide, '必要な操作を探しやすい順に並べています。', 64, 148, 960, 32, 21, '#657276');
  sections.forEach((section, i) => {
    const x = 64 + (i % 2) * 560;
    const y = 230 + Math.floor(i / 2) * 128;
    text(slide, String(i + 1).padStart(2, '0'), x, y, 56, 42, 28, accent, true);
    text(slide, section.title, x + 82, y, 410, 36, 24, '#253033', true);
    text(slide, section.body, x + 82, y + 46, 418, 44, 18, '#657276');
  });
}
function screenshotStepSlide(deck, role, accent, page, title, lead, screenshot, notes) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, page);
  text(slide, title, 64, 82, 1080, 56, 39, '#253033', true);
  text(slide, lead, 64, 148, 1010, 32, 21, '#657276');
  box(slide, 64, 212, 530, 420, '#FFFFFF', '#D9E1E3');
  image(slide, screenshot, 88, 232, 482, 375, 'contain');
  notes.forEach((note, i) => {
    const y = 238 + i * 116;
    text(slide, String(i + 1).padStart(2, '0'), 666, y, 50, 32, 23, accent, true);
    text(slide, note.title, 740, y - 2, 400, 30, 23, '#253033', true);
    text(slide, note.body, 740, y + 35, 400, 48, 17, '#657276');
    if (i < notes.length - 1) slide.shapes.add({ geometry: 'rect', position: { left: 666, top: y + 93, width: 440, height: 1 }, fill: '#D9E1E3', line: { style: 'solid', fill: '#D9E1E3', width: 0 } });
  });
}
function procedureSlide(deck, role, accent, page, iconKey, title, lead, steps, caution) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, page);
  text(slide, title, 64, 82, 1040, 56, 39, '#253033', true);
  text(slide, lead, 64, 148, 1040, 32, 21, '#657276');
  box(slide, 64, 224, 280, 300, '#FFFFFF', '#D9E1E3');
  image(slide, imageBytes[iconKey], 132, 272, 145, 145, 'contain');
  text(slide, '操作の入口', 92, 442, 224, 28, 20, '#253033', true, 'center');
  text(slide, steps[0].entry, 88, 477, 232, 30, 17, accent, true, 'center');
  steps.forEach((step, i) => {
    const y = 235 + i * 106;
    text(slide, String(i + 1).padStart(2, '0'), 420, y, 56, 42, 29, accent, true);
    text(slide, step.title, 500, y, 570, 32, 23, '#253033', true);
    text(slide, step.body, 500, y + 41, 590, 43, 17, '#657276');
    if (i < steps.length - 1) slide.shapes.add({ geometry: 'rect', position: { left: 420, top: y + 91, width: 680, height: 1 }, fill: '#D9E1E3', line: { style: 'solid', fill: '#D9E1E3', width: 0 } });
  });
  box(slide, 64, 570, 1042, 56, '#F2FBFA', accent);
  text(slide, caution, 86, 583, 1000, 28, 18, '#253033', true, 'center');
}
function checklistSlide(deck, role, accent, page, title, checks) {
  const slide = deck.slides.add();
  pageChrome(slide, role, accent, page);
  text(slide, title, 64, 82, 1080, 56, 39, '#253033', true);
  text(slide, '完了後にこの4点を確認すると、見落としを減らせます。', 64, 148, 1040, 32, 21, '#657276');
  checks.forEach((check, i) => {
    const x = 64 + i * 276;
    box(slide, x, 252, 230, 270, '#FFFFFF', '#D9E1E3');
    text(slide, '✓', x + 28, 282, 44, 44, 34, accent, true, 'center');
    text(slide, check.title, x + 28, 352, 174, 32, 22, '#253033', true, 'center');
    text(slide, check.body, x + 26, 402, 178, 68, 17, '#657276', false, 'center');
  });
  box(slide, 64, 568, 1080, 68, '#FFFFFF', accent);
  text(slide, '迷ったら、ホームに戻って「今日の予定」と「お知らせ」をもう一度確認します。', 88, 585, 1030, 32, 20, '#253033', true, 'center');
}
async function buildManual(config) {
  const deck = Presentation.create({ slideSize: { width: W, height: H } });
  cover(deck, config.role, config.accent, config.subtitle);
  contentsSlide(deck, config.role, config.accent, config.contents);
  screenshotStepSlide(deck, config.role, config.accent, 3, config.homeTitle, config.homeLead, imageBytes.home, config.homeNotes);
  procedureSlide(deck, config.role, config.accent, 4, config.primary.icon, config.primary.title, config.primary.lead, config.primary.steps, config.primary.caution);
  procedureSlide(deck, config.role, config.accent, 5, config.secondary.icon, config.secondary.title, config.secondary.lead, config.secondary.steps, config.secondary.caution);
  screenshotStepSlide(deck, config.role, config.accent, 6, config.dateTitle, '日付を切り替えて、確認・入力したい日を表示します。', imageBytes.dateSelector, config.dateNotes);
  procedureSlide(deck, config.role, config.accent, 7, config.dateAction.icon, config.dateAction.title, config.dateAction.lead, config.dateAction.steps, config.dateAction.caution);
  screenshotStepSlide(deck, config.role, config.accent, 8, 'クイックメニューから目的の機能を開く', 'ホームからすぐに開きたい機能は、クイックメニューで選択します。', imageBytes.quickMenu, [
    { title: '表示したい機能を選ぶ', body: '項目を押して選択状態にします。必要に応じて表示内容を見直します。' },
    { title: '決定する', body: '画面下部の決定を押すと、ホームのクイックメニューに反映されます。' },
    { title: '迷ったとき', body: 'まずは「出欠」「送迎」「メッセージ」を優先して表示しておくと便利です。' },
  ]);
  procedureSlide(deck, config.role, config.accent, 9, config.contact.icon, config.contact.title, config.contact.lead, config.contact.steps, config.contact.caution);
  checklistSlide(deck, config.role, config.accent, 10, config.checkTitle, config.checks);
  await save(deck, config.file);
}

await buildManual({
  role: '管理者', accent: '#008E98', subtitle: '学童全体の状況を、ひとつの画面から整える', file: 'ケーニーズ学童クラブ_管理者用ガイド.pptx',
  contents: [
    { title: 'ホームの確認', body: '送迎・予定・連絡を毎朝確認する手順' }, { title: '出欠と送迎', body: '当日の状況を確認・調整する手順' },
    { title: 'シフト作成', body: '勤務予定を作成して共有する手順' }, { title: '日付の切替', body: '確認したい日を選ぶ手順' },
    { title: 'お知らせ', body: 'スタッフ・利用者へ連絡を届ける手順' }, { title: '最後の確認', body: '対応漏れを防ぐチェック項目' },
  ],
  homeTitle: 'ホームで、今日の全体状況を確認する', homeLead: '送迎、連絡、予定変更を確認してから当日の対応を始めます。',
  homeNotes: [{ title: '送迎担当を見る', body: '担当者ごとの送迎順を確認します。色のついたカードは対応中または次の送迎です。' }, { title: 'メモ・変更を見る', body: '利用予定や送迎の変更がある日は、当日のメモと変更履歴を確認します。' }, { title: '必要な人だけ詳細へ', body: '全体表示や各メニューから、必要な情報を開きます。' }],
  primary: { icon: 'attendance', title: '出欠・送迎を確認して調整する', lead: '当日の変更を見つけたら、出欠と送迎を同じ流れで見直します。', steps: [{ entry: '出欠一覧 または 送迎管理', title: '対象の日付を開く', body: '画面上部の日付を確認し、変更したい日を表示します。' }, { entry: '', title: '利用者と送迎先を確認する', body: '出欠、迎えの有無、送迎先、時刻を上から見比べます。' }, { entry: '', title: '変更を反映して見直す', body: '保存後、ホームに戻って送迎担当の表示が合っているか確認します。' }], caution: '送迎を変更した日は、出欠と送迎先の両方を確認してから完了にします。' },
  secondary: { icon: 'shift', title: 'シフトを作成して共有する', lead: 'スタッフの勤務予定を作るときの基本手順です。', steps: [{ entry: 'シフト作成', title: '作成する期間を選ぶ', body: '対象の月と日付を確認して、入力したい期間を開きます。' }, { entry: '', title: 'スタッフごとの勤務を入力する', body: '開始・終了時刻を確認し、送迎担当と無理がないか見ます。' }, { entry: '', title: '保存後に一覧で確認する', body: '空欄や重複がないかを見て、必要ならスタッフへ共有します。' }], caution: '確定前に、送迎担当の勤務時間と送迎時刻が重なっていないか確認します。' },
  dateTitle: '確認したい日を選ぶ', dateNotes: [{ title: '年または月を押す', body: '年・月をそれぞれ押すと、必要な一覧だけを開けます。' }, { title: '対象を選択する', body: '確認・編集したい年と月を選びます。' }, { title: '決定で反映する', body: '決定後、画面上の日付が変わったことを確認します。' }],
  dateAction: { icon: 'changes', title: '予定変更の履歴を確認する', lead: '利用者からの変更がある日は、履歴を確認して当日の予定へ反映します。', steps: [{ entry: '変更履歴', title: '対象の日付を選ぶ', body: '確認したい日付へ切り替えます。' }, { entry: '', title: '変更内容を確認する', body: '利用の有無、送迎先、時刻などの変更点を読みます。' }, { entry: '', title: '関係する画面を見直す', body: '出欠・送迎・お知らせに反映漏れがないか確認します。' }], caution: '履歴を見ただけで終わらず、当日の出欠と送迎担当に反映されたか確認します。' },
  contact: { icon: 'messages', title: 'お知らせを届ける', lead: '当日に共有が必要な内容は、対象者を確認してお知らせします。', steps: [{ entry: 'お知らせ / メッセージ', title: '届ける相手を選ぶ', body: 'スタッフ向けか利用者向けかを確認します。' }, { entry: '', title: '要点を短く入力する', body: '日時、対象、対応してほしいことを先に書きます。' }, { entry: '', title: '送信後に内容を確認する', body: '誤字や対象者を確認し、必要ならホームから再確認します。' }], caution: '急な送迎変更は、お知らせだけでなく送迎画面の内容も必ず更新します。' },
  checkTitle: '管理者の業務完了チェック', checks: [{ title: '変更確認', body: '当日の予定変更を確認した' }, { title: '送迎確認', body: '担当と時刻に矛盾がない' }, { title: '連絡確認', body: '必要な人に共有できている' }, { title: '翌日確認', body: '次回のシフト・予定を確認した' }],
});

await buildManual({
  role: 'スタッフ', accent: '#397DD1', subtitle: '自分の担当と、今日必要な対応をすばやく確認する', file: 'ケーニーズ学童クラブ_スタッフ用ガイド.pptx',
  contents: [{ title: '出勤後の確認', body: 'ホームで自分の担当と連絡を見る' }, { title: '出欠記録', body: '利用者の出欠を確認・記録する' }, { title: '送迎担当', body: '送迎順と行き先を確認する' }, { title: 'シフト提出', body: '勤務可能な日時を入力する' }, { title: '日付の切替', body: '対象日を選んで確認する' }, { title: '連絡と見直し', body: 'メッセージと退勤前の確認' }],
  homeTitle: 'ホームで、自分の担当を確認する', homeLead: '出勤後はまず自分のカードと、当日の連絡を確認します。', homeNotes: [{ title: '自分の名前を探す', body: '自分のカードを見つけ、勤務時間と送迎順を確認します。' }, { title: '現在・次の送迎を確認', body: '色のついたカードを見て、今対応する送迎と次の行き先を把握します。' }, { title: 'メモを読む', body: '予定変更や管理者からの連絡がある日は、内容を確認します。' }],
  primary: { icon: 'attendance', title: '出欠を確認・記録する', lead: '利用者が来所したとき、または欠席が分かったときに記録します。', steps: [{ entry: '出欠記録', title: '日付と利用者を確認する', body: '対象の日付を見て、該当する利用者を探します。' }, { entry: '', title: '出欠の状態を入力する', body: '来所、欠席、遅刻など、実際の状況に合わせて入力します。' }, { entry: '', title: '入力後に一覧で確認する', body: '状態が反映され、他の利用者に誤りがないか見ます。' }], caution: '送迎の利用がある場合は、出欠だけでなく送迎先と時刻も確認します。' },
  secondary: { icon: 'pickup', title: '送迎担当を確認する', lead: '送迎中はホームの自分のカードを基準に、上から順番に確認します。', steps: [{ entry: 'ホーム または 送迎管理', title: '自分の担当カードを開く', body: '勤務時間と、番号順に並んだ送迎を確認します。' }, { entry: '', title: '時刻・送迎先・名前を確認する', body: '次に向かう場所と、対象の利用者を見ます。' }, { entry: '', title: '変更があれば連絡を見る', body: 'メモやメッセージに変更がないかを確認します。' }], caution: '送迎前には、時刻だけでなく送迎先と利用者名を必ずセットで確認します。' },
  dateTitle: 'シフトや予定を見る日を切り替える', dateNotes: [{ title: '年・月を選ぶ', body: '確認したい月を選択します。' }, { title: '日付を確認する', body: '選択後、画面上部の日付が合っているか見ます。' }, { title: '入力前に見直す', body: '別の日付のまま入力しないよう、日付をもう一度確認します。' }],
  dateAction: { icon: 'shift', title: 'シフトを提出する', lead: '勤務できる日時を、対象期間を確認してから入力します。', steps: [{ entry: 'シフト提出', title: '対象の期間を開く', body: '入力したい月・週が表示されているか確認します。' }, { entry: '', title: '勤務可能な時間を入力する', body: '開始・終了時刻を選び、予定と重なりがないか確認します。' }, { entry: '', title: '提出後に見直す', body: '入力した日と時間が一覧に反映されたか確認します。' }], caution: '勤務できない日も確認し、入力漏れがない状態で提出します。' },
  contact: { icon: 'messages', title: 'メッセージとお知らせを確認する', lead: '予定変更や個別連絡がある日は、対応前に内容を読みます。', steps: [{ entry: 'メッセージ / お知らせ', title: '未読の連絡を開く', body: '当日や送迎に関係する内容を優先して確認します。' }, { entry: '', title: '対応が必要な内容を整理する', body: '誰に関する変更か、いつ対応するかを確認します。' }, { entry: '', title: '必要なら返信・共有する', body: '不明点は管理者へ連絡し、自己判断で進めないようにします。' }], caution: '送迎内容が変わる連絡を見たら、ホームの担当表示も確認します。' },
  checkTitle: 'スタッフの退勤前チェック', checks: [{ title: '出欠記録', body: '当日の記録を見直した' }, { title: '送迎確認', body: '担当送迎に漏れがない' }, { title: '連絡確認', body: '未読や要対応の連絡がない' }, { title: 'シフト確認', body: '次回の勤務予定を確認した' }],
});

await buildManual({
  role: '利用者', accent: '#8A63D2', subtitle: 'お子さまの予定と、学童からの連絡をいつでも確認する', file: 'ケーニーズ学童クラブ_利用者用ガイド.pptx',
  contents: [{ title: 'ホームの確認', body: '今日の予定とお知らせを見る' }, { title: '予定変更', body: '利用・送迎の予定を変更する' }, { title: 'メッセージ', body: '学童へ連絡を送る' }, { title: '出欠確認', body: '利用予定を確認する' }, { title: '日付の切替', body: '確認したい日を選ぶ' }, { title: '送信後の確認', body: '反映漏れを防ぐチェック項目' }],
  homeTitle: 'ホームで、今日の予定と連絡を確認する', homeLead: '利用予定の確認と予定変更は、まずホームから始めます。', homeNotes: [{ title: '今日の予定を見る', body: '利用予定や送迎に関する情報を確認します。' }, { title: 'お知らせを確認する', body: '学童から届いた大切な連絡は、内容を最後まで確認します。' }, { title: 'メッセージを確認する', body: '個別のやり取りがある場合は、未読の内容を確認します。' }],
  primary: { icon: 'changes', title: '利用予定・送迎を変更する', lead: '予定が変わったときは、分かった時点で変更を入力します。', steps: [{ entry: '予定変更', title: '対象の日付を選ぶ', body: '変更したい利用日が表示されているか確認します。' }, { entry: '', title: '利用・送迎の内容を入力する', body: '利用の有無、送迎の有無、時刻や送迎先を必要に応じて変更します。' }, { entry: '', title: '送信後に内容を見直す', body: 'ホームまたは変更履歴で、入力内容が反映されたか確認します。' }], caution: '送迎だけを変更した日も、利用予定の日付が合っているか確認します。' },
  secondary: { icon: 'messages', title: '学童へメッセージを送る', lead: '質問や連絡事項がある場合は、内容を短く整理して送ります。', steps: [{ entry: 'メッセージ', title: 'やり取りする相手を開く', body: '学童とのメッセージ画面を開きます。' }, { entry: '', title: '必要な情報を入力する', body: 'お子さまの名前、対象日、伝えたい内容の順に入力します。' }, { entry: '', title: '送信後に見直す', body: '送った内容が会話に表示されていることを確認します。' }], caution: '当日の送迎変更は、メッセージだけでなく予定変更にも入力します。' },
  dateTitle: '利用予定を確認する日を選ぶ', dateNotes: [{ title: '年・月を選ぶ', body: '確認したい利用月を選択します。' }, { title: '対象の日を表示する', body: '予定変更や出欠確認をしたい日を開きます。' }, { title: '日付を見直す', body: '送信前に、画面上部の日付が合っているか確認します。' }],
  dateAction: { icon: 'attendance', title: '出欠・利用予定を確認する', lead: '送った変更が反映されているか、利用予定を定期的に確認します。', steps: [{ entry: '出欠確認', title: '確認したい日を選ぶ', body: 'ホームまたは日付選択から対象日を開きます。' }, { entry: '', title: '利用予定を確認する', body: '利用の有無、送迎に関する表示を確認します。' }, { entry: '', title: '違いがあれば変更する', body: '予定と異なる場合は、予定変更から入力し直します。' }], caution: '予定の反映に不安があるときは、日付を変えてから戻し、表示を確認します。' },
  contact: { icon: 'pickup', title: '送迎に関する情報を確認する', lead: '必要な日は、送迎先や時刻が予定どおりか確認します。', steps: [{ entry: 'ホーム / 送迎確認', title: '対象の日付を開く', body: '確認したい利用日が画面上部に表示されているか見ます。' }, { entry: '', title: '送迎内容を確認する', body: '送迎の有無、時刻、送迎先を確認します。' }, { entry: '', title: '変更があれば予定変更へ', body: '内容が違う場合は、予定変更から修正します。' }], caution: '習い事やお迎え先の変更は、分かった時点で早めに入力します。' },
  checkTitle: '利用者の送信後チェック', checks: [{ title: '日付確認', body: '変更する日が合っている' }, { title: '内容確認', body: '利用・送迎の内容が正しい' }, { title: '送信確認', body: '変更・連絡が表示されている' }, { title: '再確認', body: 'ホームで予定を見直した' }],
});
