// Multiple steps to do:
//    0. Verify base image is in Artifact Registry (done)
//    1. Verify triggers gets latest sources from GitHub including this index.js file (done)
//    2. Verify build image uses Docker to install Chrome (done)
//    3. Verify Chrome browser works directly on server after build (done)
//    4. Verify server side, thisBrowser activated by client from Google Spreadsheet app (tbd)
//    5. Verify sample page retrieved ok and that thisBrowser and thisPage persists (tbd)
//    6. Upload profile/certificates for access to www.parkrun.org.uk
//    7. Verify allowed to load content for www.parkrun.org.uk
//    8. Verify stealth access to individual parkrunner results table (although disallowed)

// const functions = require('@google-cloud/functions-framework');
// const puppeteer = require('puppeteer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

let thisBrowser;     // persists on server
let thisPage;        // re-use same page
let initPromise;     // browser "finished" after initialised (although still active)
let useTimeout;      // for browser session AND each page

let cloudBrowser = async (
  myTime = 5) =>
{
  useTimeout = myTime*60*1000;

  thisBrowser = await puppeteer.launch({  // variable delay if image not cached
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // '--ssl-certificates-file=./www.parkrun.org.uk.crt',
      // '--ssl-certificates-dir=./',
      '--cert=./www.parkrun.org.uk.pem',
      '--verbose',
    ],
    timeout: useTimeout,    // max session length
    // detached: true,         // ensure session with puppeteer persists after initial launch
    // ignoreHTTPSErrors: true
  });  
  thisPage = await thisBrowser.newPage();
  thisPage.setDefaultTimeout(useTimeout);  // Set the timeout for the page
  await thisPage.setUserAgent(userAgent);
  await thisPage.goto('about:blank');      // To verify that the browser is ready
  await new Promise(resolve => setTimeout(resolve, 11000)); // 11-second delay
  await thisBrowser.disconnect();
}
exports.initBrowser = async () => {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await cloudBrowser(7);  // Runs (detached) in the background
        console.log('Browser process ID:', thisBrowser.process().pid);
        return {statusCode: 200, body: 'Chrome browser initialised with '+thisPage.url()};
      } catch (err) {
        console.error(err);
        return {statusCode: 500, body: 'ERROR: Failed to initialise browser'};
      }
    })();
  }
  return initPromise;
};

let loadUrl = async (url) => {
  await exports.initBrowser();
  try {
    await thisPage.goto(url, {waitUntil: 'networkidle0'});
    var content = await thisPage.content();
    await new Promise(resolve => setTimeout(resolve, 11000)); // 11-second delay
    await thisBrowser.disconnect();
    return content;
  } catch (err) {
    console.error(err);
    throw err;
  }
};
exports.getUrl = async (req) => {
  try {
    var url = req.query.url;
    if (!url) {
      return {statusCode: 400, body: 'ERROR: Missing URL parameter'};
    }
    var content = await loadUrl(url);
    console.log('Browser process ID:', thisBrowser.process().pid);
    return {statusCode: 200, body: content};
  } catch (err) {
    console.error(err);
    return {statusCode: 500, body: 'ERROR: Failed to load URL, '+url};
  }
};

exports.closeBrowser = async () => {
  try {
    if (thisPage) {
      await thisPage.close();
      thisPage = null;
    }
    if (thisBrowser) {
      console.log('Closing browser process ID: ', thisBrowser.process().pid);
      await thisBrowser.close();
      thisBrowser = null;
    }
    initPromise = undefined;
    return {statusCode: 200, body: 'Browser closed successfully'};
  } catch (err) {
    initPromise = undefined;
    console.error(err);
    return {statusCode: 500, body: 'ERROR: Failed to close browser/page, '+err};
  }
};

exports.browser = async (req) => {
  var path = req.path;
  if (path === '/initBrowser') {
    return exports.initBrowser();
  } else if (path === '/getUrl') {
    return exports.getUrl(req);
  } else if (path === '/closeBrowser') {
    return exports.closeBrowser();
  } else {
    console.log('ERROR: Invalid function path, '+path);
    return {statusCode: 404, body: 'ERROR: Invalid function path, '+path};
  } 
};
