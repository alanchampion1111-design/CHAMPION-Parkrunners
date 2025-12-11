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
const puppeteer = require('puppeteer');

let thisBrowser;     // persists on server
let thisPage;        // re-use same page
let initialised = false;
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
      '--verbose',
    ],
    timeout: useTimeout,    // max session length
    detached: true,         // ensure session with puppeteer persists after initial launch
    // ignoreHTTPSErrors: true,
    // userDataDir: `/mnt/c/Users/ironc/AppData/Local/Google/Chrome/User Data/Profile\ 5`
  });  
  thisPage = await thisBrowser.newPage();
  thisPage.setDefaultTimeout(useTimeout);  // Set the timeout for the page
  await thisPage.goto('about:blank');      // To verify that the browser is ready
  await new Promise(resolve =>
    setTimeout(resolve, 1000)    // Resolve after 1s with Browser running in the background
  );
}
exports.initBrowser = async () => {
  try {
    if (!initialised) {
      setTimeout(async () => {
        await cloudBrowser(7);  // Runs (detached) in the background
        initialised = true;
      },0);
    }
    console.log('Browser process ID:', thisBrowser.process().pid);
    return {statusCode: 200, body: 'Chrome browser initialised with '+thisPage.url()
    };
  } catch (err) {
    console.error(err);
    return {statusCode: 500, body: 'ERROR: Failed to initialise browser'};
  }
};

let loadUrl = async (url) => {
  if (!initialised) {
    await exports.initBrowser();
  }
  await thisPage.goto(url, {waitUntil: 'networkidle0'});
  var content = await thisPage.content();
  return content;
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
    return {statusCode: 500, body: 'ERROR: Failed to load URL'};
  }
};

exports.closeBrowser = async () => {
  try {
    console.log('Browser process ID:', thisBrowser.process().pid);
    if (thisBrowser) {
      await thisBrowser.close();
      thisBrowser = null;
      if (thisPage) {
        await thisPage.close();
        thisPage = null;
      }
    }
    return {statusCode: 200, body: 'Browser closed successfully'};
  } catch (err) {
    console.error(err);
    return {statusCode: 500, body: 'ERROR: Failed to close browser'};
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
    return {statusCode: 404, body: 'ERROR: Functional path Not Found'};
  } 
};
