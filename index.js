// Multiple steps to do:
//    0. Verify base image is in Artifact Registry (done)
//    1. Verify triggers gets latest sources from GitHub including this index.js file (tbd)
//    2. Verify build image uses Docker to install Chrome
//    3. Verify Chrome browser works directly on server after build
//    4. Verify server side browser activated by client from Google Spreadsheet app
//    5. Verify sample page retrieved ok
//    6. Upload profile/certificates for access to www.parkrun.org.uk
//    7. Verify allowed to load content for www.parkrun.org.uk
//    8. Verify stealth access to individual parkrunner results table (although disallowed)

// const functions = require('@google-cloud/functions-framework');
const puppeteer = require('puppeteer');

let thisBrowser;    // persists on server
let useTimeout;

let cloudBrowser = async (
  myTime = 5) =>
{
  useTimeout = myTime;
  thisBrowser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
    timeout: useTimeout*60*1000,    // max session length
    // ignoreHTTPSErrors: true,
    // userDataDir: `/mnt/c/Users/ironc/AppData/Local/Google/Chrome/User Data/Profile\ 5`
  });
};

exports.initBrowser = async () => {
  try {
    await cloudBrowser(10);
    return {
      statusCode: 200,
      body: 'Chrome browser initialised'
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: 'ERROR: Failed to initialise browser'
    };
  }
};

exports.closeBrowser = async () => {
  try {
    if (thisBrowser) {
      await thisBrowser.close();
      thisBrowser = null;
    }
    return {
      statusCode: 200,
      body: 'Browser closed successfully'
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: 'ERROR: Failed to close browser'
    };
  }
};

let loadUrl = async (url) => {
  if (!thisBrowser) {
    throw new Error('Browser had failed to initialise');
  }
  var thisPage = await thisBrowser.newPage();
  thisPage.setDefaultTimeout(useTimeout*1000); // Set the timeout for the page
  await thisPage.goto(url, {waitUntil: 'networkidle0'});
  var content = await thisPage.content();
  await thisPage.close();
  return content;
};

exports.getUrl = async (req) => {
  try {
    var url = req.query.url;
    if (!url) {
      return {
        statusCode: 400,
        body: 'ERROR: Missing URL parameter'
      };
    }
    var content = await loadUrl(url);
    return {
      statusCode: 200,
      body: content
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: 'ERROR: Failed to load URL'
    };
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
    return {
        statusCode: 404,
        body: 'Not Found'
    };
  } 
};
