/********************
 * TITZ Mint dApp — Image UI build
 * - Keeps your contract logic
 * - Removes "Last minted" + "Preview by ID"
 * - Auto "Recent Mints" (last 5) at load
 * - Gallery scrolls INSIDE the bottom frame
 ********************/

// ====== EDIT THESE ======
const CONTRACT_ADDRESS = "0xc9df3da7f53a145b88b88925d380d6071f8d25c3";  // TITZ (Base)
const WALLETCONNECT_PROJECT_ID = ""; // optional; enable for QR button

// Alchemy first, Base public as fallback (you gave this key)
const RPCS = [
  "https://base-mainnet.g.alchemy.com/v2/gx1FJPkbagtcOFiznk_FI",
  "https://mainnet.base.org"
];

// Images CDN (your IPFS images root, numbered 1.png ... N.png)
const IMAGES_BASE = "https://bafybeib4tdoeyajesmm4mz5ykqhilt7s6g3cl2dsixwjwqds2dvbdjmejy.ipfs.w3s.link";
const IMAGES_EXT  = "png";
const MAX_IMAGES  = 7175;     // supply
const BATCH_SIZE  = 60;       // tiles per gallery batch

// ====== On-chain / ABI ======
const ABI = [
  "function mint(uint256 quantity) payable",
  "function saleActive() view returns (bool)",
  "function totalMinted() view returns (uint256)",
  "function remaining() view returns (uint256)",
  "function price() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];



const BASE = {
  chainIdHex: "0x2105", // 8453
  chainIdDec: 8453,
  name: "Base",
  rpcUrls: RPCS,
  explorer: "https://basescan.org",
  currency: { name: "ETH", symbol: "ETH", decimals: 18 }
};

// ====== helpers ======
const $ = (id) => document.getElementById(id);
const log = (t) => { const el = $("log"); el.textContent += "\n" + t; el.scrollTop = el.scrollHeight; };
const fmt = (wei) => ethers.utils.formatEther(wei);

// state
let provider, signer, contract, priceWei;
let injectedChosen = null;
let wcProvider = null;
const discovered = [];

// EIP-6963 discovery
window.addEventListener("eip6963:announceProvider", (ev) => {
  discovered.push(ev.detail);
  buildWalletList();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

// Build wallet selection modal list
function buildWalletList(){
  const list = $("walletList");
  list.innerHTML = "";

  for (const p of discovered){
    const btn = document.createElement("div");
    btn.className = "wbtn";
    btn.innerHTML = `<img src="${p.info.icon||''}" alt=""><span>${p.info.name||'Wallet'}</span>`;
    btn.onclick = async () => {
      injectedChosen = p.provider;
      closeModal();
      await connectInjected();
    };
    list.appendChild(btn);
  }
  if (!discovered.length && window.ethereum){
    const btn = document.createElement("div");
    btn.className = "wbtn";
    btn.innerHTML = `<img src="" alt=""><span>Browser Wallet (Injected)</span>`;
    btn.onclick = async () => { injectedChosen = window.ethereum; closeModal(); await connectInjected(); };
    list.appendChild(btn);
  }
  if (window.phantom && window.phantom.ethereum){
    const btn = document.createElement("div");
    btn.className = "wbtn";
    btn.innerHTML = `<img src="" alt=""><span>Phantom (Injected)</span>`;
    btn.onclick = async () => { injectedChosen = window.phantom.ethereum; closeModal(); await connectInjected(); };
    list.appendChild(btn);
  }
  const wcBtn = document.createElement("div");
  wcBtn.className = "wbtn" + (WALLETCONNECT_PROJECT_ID ? "" : " disabled");
  wcBtn.innerHTML = `<img src="https://raw.githubusercontent.com/WalletConnect/walletconnect-monorepo/master/packages/icons/svg/walletconnect-logo.svg" alt=""><span>WalletConnect (QR)</span>`;
  wcBtn.onclick = async () => {
    if (!WALLETCONNECT_PROJECT_ID) return;
    closeModal(); await connectWC();
  };
  list.appendChild(wcBtn);
}

function openModal(){ $("walletModal").style.display = "flex"; }
function closeModal(){ $("walletModal").style.display = "none"; }

// ====== Base network guard ======
async function ensureBase(eth){
  const cid = await eth.request({ method:"eth_chainId" });
  if (cid !== BASE.chainIdHex){
    try{
      await eth.request({ method:"wallet_switchEthereumChain", params:[{ chainId: BASE.chainIdHex }] });
    }catch(e){
      if (e.code === 4902){
        await eth.request({ method:"wallet_addEthereumChain", params:[{
          chainId: BASE.chainIdHex, chainName: BASE.name,
          rpcUrls: BASE.rpcUrls, blockExplorerUrls: [BASE.explorer],
          nativeCurrency: BASE.currency
        }]} );
      }else{ throw e; }
    }
  }
  $("network").textContent = "Network: Base";
  $("basescan").href = `${BASE.explorer}/address/${CONTRACT_ADDRESS}`;
}

// ====== Contract init ======
async function initContract(eth){
  provider = new ethers.providers.Web3Provider(eth);
  signer = provider.getSigner();
  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const addr = await signer.getAddress();
  $("addr").textContent = addr.slice(0,6) + "…" + addr.slice(-4);
  $("mint").disabled = false;

  priceWei = await contract.price();
  $("price").textContent = fmt(priceWei);
  log("Connected: " + addr + " — price " + fmt(priceWei) + " ETH");

  await syncSupply();

  eth.on?.("accountsChanged", ()=>location.reload());
  eth.on?.("chainChanged",   ()=>location.reload());
}

// ====== Connectors ======
async function connectInjected(){
  try{
    const eth = injectedChosen || window.ethereum || (window.phantom && window.phantom.ethereum);
    if (!eth){ alert("No injected wallet found. Install MetaMask / Phantom / Coinbase / Rabby."); return; }
    await eth.request({ method:"eth_requestAccounts" });
    await ensureBase(eth);
    await initContract(eth);
  }catch(e){ log("❌ " + e.message); }
}

async function connectWC(){
  try{
    const WC = window.WalletConnectEthereumProvider;
    if (!WC){ alert("WalletConnect library not loaded."); return; }
    wcProvider = await WC.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [BASE.chainIdDec],
      optionalChains: [BASE.chainIdDec],
      showQrModal: true,
      rpcMap: { [BASE.chainIdDec]: BASE.rpcUrls[0] }
    });
    await wcProvider.enable();
    await initContract(wcProvider);
    wcProvider.on("session_delete", ()=>location.reload());
  }catch(e){ log("❌ " + e.message); }
}

function disconnect(){
  try{ wcProvider?.disconnect().catch(()=>{}); }catch{}
  location.reload();
}

// ====== UI sync ======
async function syncSupply(){
  // If not connected, read via public RPC
  const rp = provider || new ethers.providers.JsonRpcProvider(BASE.rpcUrls[0]);
  const read = new ethers.Contract(CONTRACT_ADDRESS, ABI, rp);
  try{
    // price (for read-only view)
    if (!priceWei){ try{ priceWei = await read.price(); }catch{} }
    if (priceWei) $("price").textContent = fmt(priceWei);

    const minted = await read.totalMinted();
    const left   = await read.remaining();
    $("minted").textContent = minted.toString();
    $("remaining").textContent = left.toString();

    const active = await (async()=>{ try{ return await read.saleActive(); }catch{ return false; } })();
    $("sale").textContent = "Sale: " + (active ? "Active" : "Paused");
  }catch(e){
    console.warn("syncSupply()", e);
  }
}

// ====== Mint ======
async function doMint(){
  try{
    if (!signer){ log("Connect a wallet first."); return; }
    const qty = Math.max(1, parseInt($("qty").value || "1", 10));

    const active = await contract.saleActive().catch(()=>false);
    if (!active){ log("❌ Sale is not active."); return; }

    const value = priceWei.mul(qty);
    log(`Minting ${qty} for ${fmt(value)} ETH…`);

    let tx;

    // Try the function that actually exists on the contract
    try {
      // quick probe to see if mint(...) works on this contract
      await contract.estimateGas.mint(qty, { value });
      tx = await contract.mint(qty, { value, gasLimit: 250000 });
    } catch (errMint) {
      // If mint isn't there or reverts at selector, try claim(...)
      try {
        await contract.estimateGas.claim(qty, { value });
        tx = await contract.claim(qty, { value, gasLimit: 250000 });
      } catch (errClaim) {
        // show the clearest message we can get
        const msg =
          errMint?.error?.message || errMint?.data?.message || errMint?.message ||
          errClaim?.error?.message || errClaim?.data?.message || errClaim?.message ||
          "Transaction failed";
        throw new Error(msg);
      }
    }

    log("Tx sent: " + tx.hash);
    const rcpt = await tx.wait();
    log("✅ Confirmed in block " + rcpt.blockNumber);

    await syncSupply();
    await loadRecent(5); // refresh the list
  }catch(e){
    const msg = e?.error?.message || e?.data?.message || e?.message || String(e);
    log("❌ " + msg);
  }
}


// ====== Recent Mints (Alchemy v2 RPC) ======
async function loadRecent(n = 5){
  try{
    const url = `https://base-mainnet.g.alchemy.com/v2/gx1FJPkbagtcOFiznk_FI`;
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [{
        fromBlock: "0x0",
        toBlock: "latest",
        category: ["erc721"],
        contractAddresses: [CONTRACT_ADDRESS],
        order: "desc",
        withMetadata: false
      }]
    };

    console.log("Fetching recent mints via alchemy_getAssetTransfers:", body);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    console.log("Alchemy response:", data);

    const txs = (data.result?.transfers || []).filter(
      t => t.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
    );

    if (!txs.length){
      $("recentList").textContent = "No mints found (yet).";
      return;
    }

    const items = txs.slice(0, n).map(ev => {
      const id  = parseInt(ev.tokenId, 16); // tokenId is hex
      const to  = ev.to;
      const adr = `${to.slice(0,6)}…${to.slice(-4)}`;
      const tx  = `${BASE.explorer}/tx/${ev.hash}`;
      return `<div class="item">• <b>#${id}</b> → <code>${adr}</code> — <a href="${tx}" target="_blank">tx</a></div>`;
    }).join("");

    $("recentList").innerHTML = items;
  }catch(e){
    console.warn("loadRecent() error:", e);
    $("recentList").textContent = "Could not load events.";
  }
}











// ====== Gallery (scrolls inside the bottom frame) ======
let nextIndex = 1;
let observer;

function makeTile(idx){
  const url = `${IMAGES_BASE}/${idx}.${IMAGES_EXT}`;
  const tile = document.createElement("div");
  tile.className = "tile2";
  tile.innerHTML = `
    <img loading="lazy" decoding="async" alt="TITZ #${idx}" src="${url}">
    <div class="cap">#${idx}</div>
  `;
  tile.querySelector("img").onerror = () => { tile.style.display = "none"; };
  return tile;
}
function loadBatch(){
  const grid = $("galleryGrid");
  let added = 0;
  while (added < BATCH_SIZE && nextIndex <= MAX_IMAGES){
    grid.appendChild( makeTile(nextIndex) );
    nextIndex++; added++;
  }
}
function setupInfiniteScroll(){
  const sent = $("gallerySentinel");
  const root = $("galleryViewport");
  observer = new IntersectionObserver((entries)=>{
    for (const entry of entries){
      if (entry.isIntersecting) loadBatch();
    }
  }, { root, rootMargin:"400px" });
  observer.observe(sent);
}

// ====== bootstrap ======
(async function bootstrap(){
  try{
    // read-only init via public RPC
    await syncSupply();
    await loadRecent(5);
  }catch{}

  $("basescan").href = `${BASE.explorer}/address/${CONTRACT_ADDRESS}`;

  // Gallery
  setupInfiniteScroll();
  loadBatch();
})();

// ====== wire up ======
$("openConnect").onclick = () => { buildWalletList(); openModal(); };
$("closeModal").onclick  = closeModal;
$("disconnect").onclick  = disconnect;
$("mint").onclick        = doMint;

/* END */
