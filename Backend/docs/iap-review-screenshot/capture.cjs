const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1290, height: 2796, deviceScaleFactor: 1 });
  await p.goto('file://' + __dirname.replace(/\\/g, '/') + '/paywall-mockup.html');
  const el = await p.$('#capture');
  await el.screenshot({ path: 'paywall-1290x2796.png', omitBackground: false });
  await b.close();
  console.log('Saved paywall-1290x2796.png');
})();