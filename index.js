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
const browserURL = 'https://browser-automation-service-224251628103.europe-west1.run.app';
const parkrunURL = 'https://www.parkrun.org.uk';
const parkrunnerURL = parkrunURL+'/parkrunner/';

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
}

let loadUrl = async (thisUrl, pageOnly=false) => {
  // console.log('Reconnecting to browser WS Endpoint:',thisBrowserWSEp,'with same page ID,',thisPageId);
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
      await thisPage.goto(thisUrl,{waitUntil: 'domcontentloaded'});
      if (pageOnly) return thisPage;
      else {
        var content = await thisPage.content();
        // console.log('Content of page is:\n',content);
        return content;
      }
    }
  } catch (err) {
    console.error('ERROR: Failed to retrieve page:',err);
    throw err;
  }
}

exports.getUrl = async (req,res) => {
  // Default in case no ? parameters passed - sample runner is Alan
  let thisUrl = req.query?.url || 'https://www.parkrun.org.uk/parkrunner/777764/all/';
  try {
    var content = await loadUrl(thisUrl);
    res.status(200).send(content);
  } catch (err) {
    console.error(err);
    res.status(500).send('ERROR: Failed to load URL, '+thisUrl);
  } finally {
    // delay between calls (before any returns) while browser remains active
    await new Promise(resolve => setTimeout(resolve,pageSECS));
    // but NEVER disconnect because this loses the puppeteer Stealth (plugin) setting!
    // await thisBrowser.disconnect(); 
  }
}

// async function getRunnerRows(thisPage) > preview
/*
<table class="ResultsTable js-ResultsTable Results-table--compact">
:
<tbody class="js-ResultsBody">
  <tr class="Results-table-row" data-name="James HARWOOD" data-agegroup="VM35-39" ... data-gender="Male" data-position="1" ...>
  :
  </tr>
</tbody>
*/
async function getRunnerRows(thisPage) {
  // await thisPage.waitForTimeout(200); // wait a moment to sort/filter rows
  const resultsTABLE = 'tr.Results-table-row';
  await thisPage.waitForSelector(resultsTABLE);
  return await thisPage.$$(resultsTABLE);
}

async function getRunnerNames(thisPage) {
  // await thisPage.waitForTimeout(200); // wait a moment to sort/filter rows
  const resultsTABLE = 'tr.Results-table-row';
  const nameField='data-name';
  await thisPage.waitForSelector(resultsTABLE);
  return await thisPage.$$eval(resultsTABLE,
    rows => rows.map(row => row.getAttribute(nameField))
  );
}

function getMatchRow(rows,name) {
  let position = Array.from(names)
    .findIndex(row => row.getAttribute('data-name') === name);
  return position === -1 ? null : position+1;
}

function getMatchName(names, name) {
  let position = names.indexOf(name);
  return position === -1 ? null : position+1;
}

// async function sortPositions > preview
/*
  <select name="sort" class="js-ResultsSelect">
    <option value="position-asc">Sort by Position ▲</option>
    <option value="position-desc">Sort by Position ▼</option>
    <option value="runs-asc">Sort by Total parkruns ▲</option>
    <option value="runs-desc">Sort by Total parkruns ▼</option>
    <option value="agegrade-asc">Sort by Age Grade % ▲</option>
    <option value="agegrade-desc">Sort by Age Grade % ▼</option>
  </select>
*/
async function sortPositions(
  thisPage,
  order = 'position-desc')    // as is the default option on opening the page
{    // same dataset that may be quickly re-ordered if Age-Grade sort prior to getting other positions
  await thisPage.evaluate((order) => {
    const sortField = 'sort';
    const sortSelector = `select[name="${sortField}"]`;
    let sortSelect = document.querySelector(sortSelector);    // valid inside evaluate
    console.log('sortPositions sortSelect:',sortSelect);
    sortSelect.value = order;
    sortSelect.dispatchEvent(new Event('change',{bubbles: true}));
  }, order);  // ensures order is in scope of the thisPage evaluation
}

async function sortAgeGrade(thisPage,matchRunner,ageGrade) {
  try {
    await sortPositions(thisPage,'agegrade-desc');
    let runners = getRunnerNames(thisPage);
    console.log('Number of '+ageGrade+' runners found: '+runners.length);
    if (!runners) throw new Error('Failed to find any runners by '+ageGrade);
    let position = getMatchName(runners,matchRunner);
    if (position) console.log(ageGrade+' position for matching runner, '+matchRunner+' is '+position);
    else throw new Error('Failed to find matching runner, '+matchRunner+' in sorted '+ageGrade+' within results, '+thisPage.url());
    await sortPositions(thisPage); // Reset to default order before getting next order
    return position;
  } catch (err) {
    console.error(err,'on',thisPage.url());
    throw err;
  }
}

// async function filterPositions > preview
/*
  <div class="Results-filters js-ResultsFilters">
    <div class="Results-filters-input">
      <input type="text" name="search" class="js-ResultsSearch selectized"
        placeholder="Start typing to search" tabindex="-1" value="" style="display: none;">
      <div class="selectize-control js-ResultsSearch multi plugin-remove_button">
        <div class="selectize-input items not-full has-options">
          <input type="text" autocomplete="off" tabindex="" 
            placeholder="Start typing to search" style="width: 153px; opacity: 1; position: relative; left: 0px;">
        </div>
        <div class="selectize-dropdown multi js-ResultsSearch plugin-remove_button" style="display: none; width: 395px; top: 50px; left: 0px; visibility: visible;">
          <div class="selectize-dropdown-content">
            :
            // sample subset category for Gender, Age Group, & Achievement
            <div class="option" data-selectable="" data-value="gender: Male">
              <span class="value">Male</span>
              <span class="type type--gender">Gender</span>
            </div>
            <div class="option" data-selectable="" data-value="gender: Female">
              <span class="value">Female</span>
              <span class="type type--gender">Gender</span>
            </div>
            <div class="option" data-selectable="" data-value="agegroup: JM10">
              <span class="value">JM10</span>
              <span class="type type--agegroup">Age Group</span>
            </div>
            :
            // samples after typing VM, which automatically gets highlighted
            <div class="option" data-selectable="" data-value="agegroup: VM35-39">
              <span class="value"><span class="highlight">VM</span>35-39</span>
              <span class="type type--agegroup">Age Group</span>
            </div>
            <div class="option" data-selectable="" data-value="agegroup: VM40-44">
              <span class="value"><span class="highlight">VM</span>40-44</span>
              <span class="type type--agegroup">Age Group</span>
            </div>
            :
          </div>
        </div>
      </div>
    </div>
  </div>
*/
async function filterPositions(
  thisPage,
  category = '')  // default removes filter
{
  await thisPage.evaluate((category) => {    // Enter category and trigger search
    // WARNING: thisPage.waitForSelector('input[name="search"]') fails because display: none
    // ... div.selectize-input.items.not-full.has-options
    const inputSelector = '.selectize-input input';  // abbreviated form
    let filterSelect = document.querySelector(inputSelector);  // valid inside evaluate
    if (!filterSelect) throw new Error('The input filter selector, '+inputSelector+' was NOT found!');
    else console.log('The input filter selector, '+inputSelector+' was found');
    filterSelect.value = category;
    filterSelect.dispatchEvent(new Event('input',{bubbles: true}));
  }, category);
  await thisPage.waitForFunction((category) => {  //...and wait for a matching pull-down optopn
    const optionValue = 'agegroup: '+category;    // otherwise gender: when Male/Female
    const dataField = 'data-value';
    let filterOption = document.querySelector(
      `.selectize-dropdown-content .option[${dataField}="${optionValue}"]`
    );
    let filterMatch = filterOption && (filterOption.getAttribute(dataField) === optionValue);
    if (!filterMatch) throw new Error('The filter option for '+category+' did NOT match any pull-down option!');
    else console.log('The filter option for '+category+' matched a pull-down option');
  }, category);
}

async function filterAgeCategory(thisPage,matchRunner,ageCat) {
  // Assumes default order of run-time position is preset on runner list (position-desc)
  try {
    await filterPositions(thisPage,ageCat);
    let runners = getRunnerNames(thisPage);
    console.log('Number of '+ageCat+' runners found: '+runners.length);
    if (!runners) throw new Error('Failed to filter on Age-Category, '+ageCat);
    let position = getMatchName(runners,matchRunner);
    if (position) console.log(ageCat+' position for matching runner, '+matchRunner+' is '+position);
    else throw new Error('Failed to find matching runner, '+matchRunner+' in filtered '+ageCat+' within results, '+thisPage.url());
    await filterPositions(thisPage); // Reset filter WHEN a subsequent position required (e.g. Gender position)
    return position;
  } catch (err) {
    console.error(err, 'on', thisPage.url());
    throw err;
  }
}

/**
* Called by GAS UrlFetch function, (via browser function to switch below)
*   Example https://<GC service>.run.app?url=https://www.parkrun.org.uk/havant/results/638&rn=Dave+BUSH&ac=VM55-59&ag=
* Returns two positions (in JSON format): Age-Category order and Age-Grade (%age) order
*/
exports.filterUrl = async (req,res) => {
  // Default parameters in case no ? and & parameters passed
  let thisUrl = req.query?.url     || 'https://www.parkrun.org.uk/havant/results/638/';  // Sample parkrun event
  let matchRunner = decodeURIComponent(req.query?.rn) || 'Dave BUSH';  // Sample runner at Havant parkrun #638
  let ageCat = req.query?.ac       || 'VM55-59';      // Age-Category filter for matching Dave (expect 2)
  let ageGrade = req.query?.ag     || 'Age-Grade';    // Age-Grade sort for matching Dave (expect 9)
// begin
  console.log('thisUrl: '+thisUrl);
  console.log('matchRunner: '+matchRunner);
  console.log('ageCat: '+ageCat);
  console.log('ageGrade: '+ageGrade);
  var testCmd = 'curl -X GET "'+browserURL+'/filterUrl'+'?url='+thisUrl+'&rn='+matchRunner+'&ac='+ageCat+'" \\'
    +'-H "Athorization: bearer $(gcloud auth print-identity-token)" \\'
    +'-H "Content-Type: application/json"';
  console.log('Test: '+testCmd);
  var thisPage = await loadUrl(thisUrl,true);
  try {  // Get 2 (or more) positions in series
    // 1. Sort by (descending) Age-Grade, to get ageGrade position of matchRunner
    let agPosition = await sortAgeGrade(thisPage,matchRunner,ageGrade);
    // 2. Filter by Age-Category to get ageCat position of matchRunner
    let acPosition = await filterAgeCategory(thisPage,matchRunner,ageCat);
    res.status(200).json({acPosition,agPosition});    // in expected order
  } catch (err) {
    console.error('ERROR:',err);
    res.status(500).send('ERROR: '+err.message);
  } finally {
    // await thisPage.close();  // re-use page may fail??, consider new Page for each parkrun results instance
    console.warn('WARNING: If re-using the same page, the normal parallel performance may be slower (or otherwise interfere)');
  }
}

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
}

async function deleteCookies(page,targetUrl) {
  try {
    let cookies = await page.cookies();
    if (await cookies.find(c => c.name === 'psc')) {
      await page.deleteCookie({name:'psc',url:targetUrl});
      await page.reload();
    }
  } catch (err) {
    console.log('Cookie for url,',targetUrl,'to be deleted was not found:',err);
  }
}

exports.acceptCookies = async (_,res) => {
  let cookieJar = [
    'https://www.parkrun.org.uk',
    'https://www.parkrun.com'
  ];
  
  try {
    let thisBrowser = await puppeteer.launch({  // variable delay if image not cached?
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
    let thisPage = await thisBrowser.newPage();
    try {
      thisCookieURL = cookieJar[0];    // assume org.uk Cookie will suffice
      await thisPage.goto(thisCookieURL,{waitUntil: 'domcontentloaded',timeout: 10000});
      const acceptButton = `button.cm__btn[data-role="all"]`;
      try {
        thisPage.waitForSelector(acceptButton, {timeout: 10000});
        await thisPage.setCookie({
          name: 'psc',
          value: 'some-value',
          domain: 'www.parkrun.org.uk'
        });
        await thisPage.click(acceptButton);
        console.log('Cookies accepted for sites,',cookieJar);
        res.status(200).send('Required Cookies accepted for sites, '+cookieJar);
      } catch (warning) {    // If no Accept button appears, then that is the norm
        // WARNING Perhaps retry in case page not fully evaluated or delete and redo
        // TODO: deleteCookies(thisPage,thisCookieURL);
        console.warn('WARNING:',warning);    // check logs in case failed for button not detected
        console.log('No button presented for Cookies to be accepted on sites, ',cookieJar);
        res.status(200).send('No button presented for Cookies to be accepted on sites, '+cookieJar);
      }
    } catch (err) {
      console.error('ERROR: Failed to load page,',thisCookieURL,' to check Cookies:',err);
      res.status(500).send('ERROR: Failed to load page, '+thisCookieURL+' to check Cookies ok: '+err);
    }
  } catch (err) {
    console.error('ERROR: Failed to launch browser to check Cookies ok:',err);
    res.status(500).send('ERROR: Failed to launch browser to check Cookies ok: '+err);
  } finally {
    if (thisBrowser) await thisBrowser.close();
  }
}

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
  } else if (path === '/filterUrl') {
    exports.filterUrl(req,res);
  } else if (path === '/stopBrowser') {
    exports.stopBrowser(req,res);
  } else if (path === '/acceptCookies') {
    exports.acceptCookies(req,res);
  } else {
    console.log('ERROR: Invalid Cloud Run function path,',path);
    res.status(404).send('ERROR: Invalid Cloud Run function path, '+path);
  } 
}
