// Multiple steps to do:
//    0. Verify base image is in Artifact Registry (done)
//    1. Verify triggers gets latest sources from GitHub including this index.js file (done)
//    2. Verify build image uses Docker to install Chrome (done)
//    3. Verify Chrome browser works directly on server after build (done)
//    4. Verify server side, thisBrowser activated by client from Google Spreadsheet app (done)
//    5. Verify sample page retrieved ok and that thisBrowser and thisPage persists (done)
//    6. Upload profile/certificates for access to www.parkrun.org.uk (done)
//    7. Verify allowed to load content for www.parkrun.org.uk (done)
//    8. Verify stealth access to individual parkrunner results table (tbd - although disallowed)

// const functions = require('@google-cloud/functions-framework');
// const puppeteer = require('puppeteer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const url = require('url');
let thisBrowserWSEp;  // browser persists on server   
let thisPageId;       // re-use same page      
let browserTimeout;   // for browser session
let browserTimer;
const launchSECS = 45000;
const pageSECS = 15000;   // minimum of 10 seconds between page accesses on parkrun site
let initPromise;      // browser "finished" after initialised (although still active

let cloudBrowser = async (
  sessionLimit = 5) =>
{
  browserTimeout = sessionLimit*60*1000;
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
  browserTimer = setTimeout(async () => {
    try {
      console.warn('WARNING: Terminating browser due to timeout:',browserTimeout);
      await thisBrowser.close();
    } catch (err) {
      console.error('ERROR: Terminating browser on timeout:',err);
    } finally {
      initPromise = undefined;
      thisBrowserWSEp = null;
      thisPageId = null;
      clearTimeout(browserTimer);
    }
  }, browserTimeout);
  thisBrowserWSEp = thisBrowser ? thisBrowser.wsEndpoint() : null;  // return to client (although also global)
  console.log('Retained browser WS Endpoint:',thisBrowserWSEp);
  try {
    var thisPage = await thisBrowser.newPage();
    if (thisPage) {
      thisPageId = await thisPage.target()._targetId;
      console.log('Retained page ID,',thisPageId);
      thisPage.setDefaultTimeout(pageSECS);  // Set the timeout for loading the page
      await thisPage.setUserAgent(userAgent);
      await thisPage.goto('about:blank');    // To verify that the browser is ready
      console.log('Blank page loaded');
    } else {
      console.warn('WARNING: Potentially failed to retain page ID,',thisPageId);
    }
  } catch (err) {
    console.error('ERROR: Getting page ID:', err);
  }
}
exports.initBrowser = async (_,res) => {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await cloudBrowser(7);  // Launched ok, but browser active in background
        res.status(200).send(thisBrowserWSEp);
      } catch (err) {
        console.error('ERROR: Failed to initialise browser:',err);
        // consider a relaunch with args, --pull from Docker if image is not properly cached!
        res.status(500).send('ERROR: Failed to initialise browser, '+err);
      } finally {
        // NEVER disconnect because this loses the puppeteer Stealth (plugin) setting!
        // await thisBrowser.disconnect();
        console.log('Returning immediately after (attempt at) launching browser');
      }
    })();
  } else {  // do nothing because browser previously launched
    res.status(200).send(thisBrowserWSEp);
  }
};

let loadUrl = async (thisUrl) => {
  console.log('Reconnecting to browser WS Endpoint:',thisBrowserWSEp,'with same page ID,',thisPageId);
  try {
    if (!thisBrowserWSEp) {
      console.error('ERROR: Persistent browser not found:',thisBrowserWSEp,'with timeout', browserTimeout);
      throw new Error('Persistent browser not found');
    } else {
      console.log('Persistent browser not found,',browserTimeout);
      var thisBrowser = await puppeteer    // actually reconnect
        .connect({ browserWSEndpoint: thisBrowserWSEp });
      var thisPage = (await thisBrowser.pages())
        .find(page => page.target()._targetId === thisPageId);
      if (thisPage) {
        await thisPage.setDefaultTimeout(pageSECS);
      } else {
        console.error('ERROR: Persistent page not found:',thisPageId,'with timeout', pageSECS);
        throw new Error('Persistent page not found');
      }
      console.log('Persistent browser timeout,',browserTimeout,'with inter-page access delay,',pageSECS);
      console.log('Loading page with URL,',thisUrl);
      await thisPage.goto(thisUrl,{waitUntil: 'networkidle0'});
      var content = await thisPage.content();
      console.log('Content of page is:\n',content);
      return content;
    }
  } catch (err) {
    console.error('ERROR: Failed to retrieve page:',err);
    throw err;
  }
};
exports.getUrl = async (req,res) => {
  try {
    var thisUrl = req.query.url;
    if (!thisUrl) {
      res.status(400).send('ERROR: Missing URL parameter');
    } else {
      var content = await loadUrl(thisUrl);
      res.status(200).send(content);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('ERROR: Failed to load URL, '+thisUrl);
  } finally {
    // delay between calls (before any returns) while browser remains active
    await new Promise(resolve => setTimeout(resolve,pageSECS));
    // but NEVER disconnect because this loses the puppeteer Stealth (plugin) setting!
    // await thisBrowser.disconnect(); 
  }
};

exports.stopBrowser = async (_,res) => {
  try {
    if (thisBrowserWSEp) {
      var thisBrowser = await puppeteer
        .connect({ browserWSEndpoint: thisBrowserWSEp });
      if (thisPageId) {
        var thisPage = (await thisBrowser.pages())
          .find(page => page.target()._targetId === thisPageId);
        if (thisPage) {
          await thisPage.close();
          console.log('Page closed successfully - Page Id:',thisPageId);
        } else {
          console.warn('WARNING: Page previously closed or timed out - Page Id:',thisPageId);
        }
      }
      if (thisBrowser && thisBrowser.isConnected()) {
        await thisBrowser.close();
        console.log('Browser terminated successfully - WS endpoint:',thisBrowserWSEp);
        res.status(200).send('Browser terminated successfully');
      } else {
        console.warn('WARNING: Browser previously aborted or timed out - WS endpoint:',thisBrowserWSEp);
        res.status(204).send('WARNING: Browser previously aborted or timed out');
      }
    } else {
      console.warn('WARNING: Browser previously terminated - WS endpoint:',thisBrowserWSEp);
      res.status(204).send('WARNING: Browser previously terminated');
    }
  } catch (err) {
    console.error('ERROR: Failed to close page and/or terminate browser:',err);
    res.status(500).send('ERROR: Failed to close page and/or terminate browser, '+err);
  } finally {  // executed in all cases, even before the returns
    initPromise = undefined;
    thisBrowserWSEp = null;
    thisPageId = null;
    clearTimeout(browserTimer);
  }
};

cookieJar = [
  'https://www.parkrun.org.uk',
  'https://www.parkrun.com'
];
expectedCookie = 'parkrun-smart-cookie';
acceptedChoice = '#smart-surfer-choice-buttons-choice-1';

exports.acceptCookies = async (_,res) => {
  try {
    var thisBrowser = await puppeteer.launch({  // variable delay if image not cached?
      headless: true,
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--cert=./www.parkrun.org.uk.pem',
        '--verbose',
      ],
      timeout: launchSECS,       // max launch time
    });
    var thisPage = await thisBrowser.newPage();
    for (let thisSite of cookieJar) {
      await thisPage.goto(thisSite);
      var thisFrameCookie = await thisPage.frames()
        .find(f => f.url().includes(expectedCookie));
      if (thisFrameCookie) {
        try {
          await thisFrameCookie.waitForSelector(acceptedChoice,{timeout: 3000});
          await thisFrameCookie.click(acceptedChoice,{timeout: 2000});
          console.log('Cookie accepted for site, '+thisSite);
        } catch (err) {
          console.log(await thisFrameCookie.content());
          console.error('ERROR: Prompt for cookie, '+expectedCookie+' on '+thisSite+
            ' requested, but choice ('+acceptedChoice+') not offered');
          res.status(500).send('ERROR: Failed to offer choice of cookie acceptance: '+err);
        }
      } else {
        console.log('Prompt for cookie, '+expectedCookie+' not requested from site, '+thisSite);
      }
    }
    await thisBrowser.close();
    res.status(200).send('All required cookies in place');
  } catch (err) {
    console.error('ERROR: Failed to accept required Cookies:',err);
    res.status(500).send('ERROR: Failed to accept required Cookies: '+err);
  }
};

/**
*  This browser function provides a convenient single entry point (as defined in package.json).
*  Nevertheless, the delegated URL-based functions are equally valid entry and exit points.
"  Therefore, await is redundant in calling these functions because each effect the return directly.
*
*  INFO : The return parameter, 'res' is critical within the (Node.js) delegated functions:
*    1. .status(200) to return the HTTP statusCode (where 200 = success)
*    2. .type() to set the Content-Type header
*          - normally, implcit from content: text/plain (default), text/html or application/json
*          - alternatively, explicitly also using res.setHeader('Content-Type', type)
*    3. .send(body) to return the body AND to end the call back to the Google Spreadsheet client
*          - alternativly, .end may return plain/text or follow (one or more) .write
*/
exports.browser = async (req,res) => {
  var parsedUrl = url.parse(req.url,true);
  var path = parsedUrl.pathname;
  if (path === '/initBrowser') {
    exports.initBrowser(req,res);
  } else if (path === '/getUrl') {
    exports.getUrl(req,res);
  } else if (path === '/stopBrowser') {
    exports.stopBrowser(req,res
  } else if (path === '/acceptCookies') {
    exports.acceptCookies(req,res);
  } else {
    console.log('ERROR: Invalid Cloud Run function path,',path);
    res.status(404).send('ERROR: Invalid Cloud Run function path, '+path);
  } 
};
