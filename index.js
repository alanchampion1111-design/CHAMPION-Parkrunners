// const functions = require('@google-cloud/functions-framework');
const puppeteer = require('puppeteer');
let thisBrowser;  // persists on server (and so req redundant unless carrying the url)
let useTimeout;

let cloudBrowser = async (
  myTime = 5,
  user = 'ironc',
  profile = '5') =>
{
  useTimeout = myTime;
  thisBrowser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    timeout: useTimeout*1000,    // max session length
    // userDataDir: `/mnt/c/Users/${user}/AppData/Local/Google/Chrome/User Data/${profile}`
  });
};

exports.initBrowser = async (_,res) => {        // req unused
  try {
    await cloudBrowser(3);
    res.status(200).send('Chrome browser initialised');
  } catch (err) {
    console.error(err);
    res.status(500).send('ERROR: Failed to initialise browser');
  }
};

exports.closeBrowser = async (_, res) => {      // req unused
  if (thisBrowser) {
    await thisBrowser.close();
    thisBrowser = null;
    res.status(200).send('Activation complete!');
  }
};

let loadUrl = async (url) => {
  if (!thisBrowser) {
    throw new Error('Browser had failed to initialise');
  }
  var thisPage = await thisBrowser.newPage();
  thisPage.setDefaultTimeout(useTimeout*1000); // Set the timeout for the page
  await thisPage.goto(url, {
    waitUntil: 'networkidle0'
  });
  var content = await thisPage.content();
  await thisPage.close();
  return content;
};

exports.getUrl = async (req,res) => {
  try {
    var url = req.query.url;
    if (!url) {
      res.status(400).send('ERROR: Missing URL parameter');
      return;
    }
    var content = await loadUrl(url);
    res.status(200).send(content);
  } catch (err) {
    console.error(err);
    res.status(500).send('ERROR: Failed to load URL');
  }
};

exports.browser = async (req,res) => {
  var path = req.path;
  if (path === '/initBrowser') {
    await exports.initBrowser(req,res);
  } else if (path === '/getUrl') {
    await exports.getUrl(req, res);
  } else if (path === '/closeBrowser') {
    await exports.closeBrowser(req,res);
  } else {
    res.status(404).send('Not Found');
  }
};
