require("colors");

function displayHeader() {
  process.stdout.write("\x1Bc");
  console.log("========================================".magenta);
  console.log("=          Monad Testnet Bot           =".magenta);
  console.log("=     Created by HappyCuanAirdrop      =".magenta);
  console.log("=    https://t.me/HappyCuanAirdrop     =".magenta);
  console.log("========================================".magenta);
  console.log();
}

module.exports = displayHeader;
