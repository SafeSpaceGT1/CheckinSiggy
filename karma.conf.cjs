// Playwright provisions a reproducible browser in local development and CI.
if (!process.env.CHROME_BIN) process.env.CHROME_BIN = require('@playwright/test').chromium.executablePath();
module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher'), require('karma-coverage')],
    reporters: ['progress', 'coverage'],
    coverageReporter: { dir: require('path').join(__dirname, 'coverage'), subdir: '.', reporters: [{ type: 'text-summary' }, { type: 'lcovonly' }] },
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: { ChromeHeadlessNoSandbox: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--disable-dev-shm-usage'] } },
    singleRun: true,
    client: { jasmine: { random: true } },
    browserNoActivityTimeout: 60000,
  });
};
