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

let thisBrowserWSEp;  // browser persists on server   
let thisPageId;       // re-use same page      
let initPromise;      // browser "finished" after initialised (although still active)
let browserTimeout;   // for browser session
const launchSECS = 45000;
const pageSECS = 11000;   // 11 seconds between page accesses

let cloudBrowser = async (
  myTime = 5) =>
{
  browserTimeout = myTime*60*1000;
  var thisBrowser = await puppeteer.launch({  // variable delay if image not cached?
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
    timeout: launchSECS,       // max launch time
    // detached: true,         // ensure session with puppeteer persists after initial launch
    // ignoreHTTPSErrors: true
  });
  // Set a timer to close the browser by default after the timeout
  const browserTimer = setTimeout(async () => {
    try {
      console.warn('WARNING: Closing browser due to timeout:',browserTimeout);
      await thisBrowser.close();
    } catch (err) {
      console.error('ERROR: closing browser:',err);
    }
  }, browserTimeout);
  thisBrowserWSEp = thisBrowser.wsEndpoint();
  var thisPage = await thisBrowser.newPage();
  var target = await thisPage.target();
  thisPageId = target.targetId;
  console.log('Retain browser WS Endpoint:',thisBrowserWSEp,'with retained page ID,',thisPageId);
  thisPage.setDefaultTimeout(pageSECS);  // Set the timeout for loading the page
  await thisPage.setUserAgent(userAgent);
  await thisPage.goto('about:blank');    // To verify that the browser is ready
  console.log('Blank page loaded');
  await thisBrowser.disconnect();
}
exports.initBrowser = async () => {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await cloudBrowser(5);  // Expected to continue after launch in the background
        return {statusCode: 200, body: 'Chrome browser initialised'};
      } catch (err) {
        console.error(err);
        // consider a relaunch with args, --pull from Docker if image is not properly cached!
        return {statusCode: 500, body: 'ERROR: Failed to initialise browser'};
      }
    })();
  }
  return initPromise;
};

let loadUrl = async (url) => {
  try {
    var thisBrowser = await puppeteer.connect(
      { browserWSEndpoint: thisBrowserWSEp }
    );
    var thisPage = await thisBrowser.pages()
      .then(pages => pages.find(page => page
        .target().targetId === thisPageId)
      );
    console.log('Reconnected to browser WS Endpoint:',thisBrowserWSEp,'with same page ID,',thisPageId);
    thisPage.setDefaultTimeout(pageSECS);  // Set the timeout for loading the page
    console.log('Persistent browser timeout,',browserTimeout,'with inter-page access delay,',pageSECS);
    await thisPage.setUserAgent(userAgent);
    console.log('Loading page with URL,',thisPage.url());
    await thisPage.goto(url,
      {waitUntil: 'networkidle0'}
    );
    var content = await thisPage.content();
    console.log('Content of page is:\n',content);
    await new Promise(resolve => setTimeout(resolve,pageSECS));
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
    return {statusCode: 200, body: content};
  } catch (err) {
    console.error(err);
    return {statusCode: 500, body: 'ERROR: Failed to load URL, '+url};
  }
};

exports.closeBrowser = async () => {
  try {
    if (thisBrowserWSEp) {
      var thisBrowser = await puppeteer.connect(
        { browserWSEndpoint: thisBrowserWSEp }
      );
      if (thisPageId) {
        var thisPage = await thisBrowser.pages()
          .then(pages => pages.find(page => page
            .target().targetId === thisPageId)
          );
        await thisPage.close();
        thisPageId = null;
      }
      if (thisBrowser.isConnected()) {
        await thisBrowser.close();
      }
    }
    thisBrowserWSEp = null;
    console.log('Closing browser on completion');
    initPromise = undefined;
    return {statusCode: 200, body: 'Browser closed successfully'};
  } catch (err) {
    initPromise = undefined;
    thisBrowserWSEp = null;
    thisPageId = null;
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
