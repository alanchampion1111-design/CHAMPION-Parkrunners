const puppeteer = require('puppeteer');

let automateBrowser = async (
  user = 'ironc',
  profile = '5') =>
{
  var browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    userDataDir: `/mnt/c/Users/${user}/AppData/Local/Google/Chrome/User Data/${profile}`
  });
  // Automate browser interaction...
  // return browser;    // subsequently for navigation to URL(s)
  await browser.close();
};

exports.browserAutomation = async (req, res) => {
  try {
    await automateBrowser();
    res.status(200).send('Automation complete!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error occurred');
  }
};
