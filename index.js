const http = require('http');
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
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.send('Automation complete!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error occurred');
    res.end('Error occurred');
  }
};

const server = http.createServer(exports.browserAutomation);
server.listen(8080, () => {
  console.log('Server listening on port 8080');
});
