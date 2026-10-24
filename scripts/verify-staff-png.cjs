const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('C:/Users/syado/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, timezoneId: 'Asia/Tokyo', acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('loggedInUser', JSON.stringify({ role: 'staff', name: '表示確認用スタッフ' })));
    await page.goto('http://localhost:8081/shift-view');
    await page.getByText('シフト提出する', { exact: true }).waitFor();
    const downloadButton = page.getByRole('button', { name: 'シフト表をPNGで保存', exact: true });
    await downloadButton.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="シフト表をPNGで保存"]')?.getAttribute('aria-disabled') !== 'true', { timeout: 45000 });
    const saveBounds = await downloadButton.boundingBox();
    const toggleBounds = await page.getByLabel('自分のみ表示', { exact: true }).boundingBox();
    assert(saveBounds.y + saveBounds.height < toggleBounds.y, 'Download button overlaps display toggle');
    let downloads = 0;
    page.on('download', () => downloads++);
    await downloadButton.click();
    await page.getByText('シフト表を保存しますか？', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(process.env.TEMP, 'staff-shift-png-confirm.png') });
    await page.getByRole('button', { name: 'いいえ', exact: true }).click();
    assert.equal(downloads, 0);
    await downloadButton.click();
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: 'はい', exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^シフト_\d{4}年\d{1,2}月\.png$/);
    const destination = path.join(process.env.TEMP, 'staff-shift-downloaded.png');
    await download.saveAs(destination);
    const png = await fs.readFile(destination);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert(width >= 2000 && height >= 2000 && png.length > 100000, 'PNG appears incomplete');
    await page.getByText('シフト提出する', { exact: true }).click();
    await page.getByText('シフト提出', { exact: true }).first().waitFor();
    await page.reload();
    await page.getByText('シフト提出する', { exact: true }).waitFor();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: path.join(process.env.TEMP, 'staff-shift-png-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile page overflows horizontally');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', cancelledWithoutDownload: true, filename: download.suggestedFilename(), width, height, bytes: png.length, submissionOpens: true, mobileWidth: 360, png: destination }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
